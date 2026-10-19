const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase, passwordRecord, verifyPassword, generateWalletAddress } = require('./db');
const { MarketService } = require('./market');

const db = openDatabase();
const market = new MarketService(db);
const sessions = new Map();
const publicDir = path.join(process.cwd(), 'public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

function error(res, status, message) { json(res, status, { error: message }); }

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2));
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).t1337_session;
  const userId = token && sessions.get(token);
  return userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
}

function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) error(res, 401, 'Sign in to continue.');
  return user;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON body.'); }
}

function safeUser(user, viewerId = null) {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id = ?) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
      (SELECT COUNT(*) FROM trades WHERE user_id = ?) AS trades,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?) AS isFollowing
  `).get(user.id, user.id, user.id, viewerId || -1, user.id);
  const contact = viewerId && viewerId !== user.id ? db.prepare(`
    SELECT id, status, CASE WHEN requester_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
    FROM contacts WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
    ORDER BY id DESC LIMIT 1
  `).get(viewerId, viewerId, user.id, user.id, viewerId) : null;
  return {
    id: user.id, username: user.username, displayName: user.display_name, bio: user.bio,
    walletAddress: user.wallet_address,
    avatarColor: user.avatar_color, createdAt: user.created_at,
    contactStatus: contact?.status === 'accepted' ? 'accepted' : contact?.direction || 'none',
    contactRequestId: contact?.id || null,
    ...counts,
  };
}

function portfolioFor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const holdings = db.prepare(`
    SELECT a.id AS assetId, a.symbol, a.name, a.color, a.provider_id AS providerId,
           a.category, a.source, a.icon_url AS iconUrl,
           a.last_price_cents AS priceCents, a.change_24h AS change24h,
           h.quantity, h.average_cost_cents AS averageCostCents
    FROM holdings h JOIN assets a ON a.id = h.asset_id
    WHERE h.user_id = ? AND h.quantity > 0.00000001
    ORDER BY (h.quantity * a.last_price_cents) DESC
  `).all(userId).map((row) => ({
    ...row,
    valueCents: Math.round(row.quantity * row.priceCents),
    costCents: Math.round(row.quantity * row.averageCostCents),
    returnCents: Math.round(row.quantity * (row.priceCents - row.averageCostCents)),
    returnPercent: row.averageCostCents ? ((row.priceCents / row.averageCostCents) - 1) * 100 : 0,
  }));
  const investedCents = holdings.reduce((sum, item) => sum + item.valueCents, 0);
  const costCents = holdings.reduce((sum, item) => sum + item.costCents, 0);
  return { cashCents: user.cash_cents, investedCents, totalCents: user.cash_cents + investedCents, returnCents: investedCents - costCents, holdings };
}

function feedFor(viewerId, cursor = Number.MAX_SAFE_INTEGER, limit = 12, authorId = null, recentOnly = false) {
  return db.prepare(`
    SELECT t.id, t.side, t.quantity, t.price_cents AS priceCents, t.total_cents AS totalCents,
      t.created_at AS createdAt, t.source_trade_id AS sourceTradeId,
      u.id AS userId, u.username, u.avatar_color AS avatarColor,
      a.id AS assetId, a.symbol, a.name AS assetName, a.color AS assetColor,
      a.provider_id AS providerId, a.icon_url AS iconUrl, a.category, a.change_24h AS change24h,
      a.last_price_cents AS currentPriceCents,
      (SELECT COUNT(*) FROM likes WHERE trade_id = t.id) AS likes,
      (SELECT COUNT(*) FROM comments WHERE trade_id = t.id) AS comments,
      (SELECT COUNT(*) FROM trades WHERE source_trade_id = t.id) AS copies,
      EXISTS(SELECT 1 FROM likes WHERE user_id = ? AND trade_id = t.id) AS liked
    FROM trades t JOIN users u ON u.id = t.user_id JOIN assets a ON a.id = t.asset_id
    WHERE t.id < ? AND (? IS NULL OR t.user_id = ?)
      AND (? = 0 OR datetime(t.created_at) >= datetime('now', '-7 days'))
    ORDER BY t.id DESC LIMIT ?
  `).all(viewerId, cursor, authorId, authorId, recentOnly ? 1 : 0, limit);
}

function historyFor(userId, offset = 0, limit = 20) {
  return db.prepare(`
    SELECT * FROM (
      SELECT 'trade-' || t.id AS eventId, t.id, t.side AS type, t.quantity AS amount,
        t.price_cents AS priceCents, t.total_cents AS totalCents, t.created_at AS createdAt,
        a.symbol, a.name AS assetName, a.id AS assetId, a.provider_id AS providerId,
        a.icon_url AS iconUrl, NULL AS counterpartyWallet
      FROM trades t JOIN assets a ON a.id = t.asset_id WHERE t.user_id = ?
      UNION ALL
      SELECT 'transfer-' || tr.id AS eventId, tr.id,
        CASE WHEN tr.sender_id = ? THEN 'sent' ELSE 'received' END AS type,
        tr.amount, NULL AS priceCents, NULL AS totalCents, tr.created_at AS createdAt,
        a.symbol, a.name AS assetName, a.id AS assetId, a.provider_id AS providerId,
        a.icon_url AS iconUrl,
        CASE WHEN tr.sender_id = ? THEN recipient.wallet_address ELSE sender.wallet_address END AS counterpartyWallet
      FROM transfers tr
      JOIN users sender ON sender.id = tr.sender_id
      JOIN users recipient ON recipient.id = tr.recipient_id
      LEFT JOIN assets a ON a.id = tr.asset_id
      WHERE tr.sender_id = ? OR tr.recipient_id = ?
    ) ORDER BY createdAt DESC, eventId DESC LIMIT ? OFFSET ?
  `).all(userId, userId, userId, userId, userId, limit, Math.max(0, offset));
}

function communityPosts(viewerId, offset = 0, limit = 12, followedOnly = false) {
  const following = followedOnly ? 'AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_id = p.user_id)' : '';
  const parameters = followedOnly ? [viewerId, viewerId, limit, offset] : [viewerId, limit, offset];
  return db.prepare(`
    SELECT p.id, p.body, p.created_at AS createdAt,
      u.id AS userId, u.username, u.avatar_color AS avatarColor,
      ra.id AS referencedAssetId, ra.symbol AS referencedSymbol, ra.name AS referencedAssetName,
      ra.color AS referencedAssetColor, ra.last_price_cents AS referencedPriceCents,
      ra.provider_id AS referencedProviderId, ra.icon_url AS referencedIconUrl,
      ra.change_24h AS referencedChange24h, ra.category AS referencedCategory,
      t.id AS tradeId, t.side AS tradeSide, t.quantity AS tradeQuantity,
      t.price_cents AS tradePriceCents, t.total_cents AS tradeTotalCents, t.created_at AS tradeCreatedAt,
      ta.id AS tradeAssetId, ta.symbol AS tradeSymbol, ta.name AS tradeAssetName, ta.color AS tradeAssetColor,
      ta.provider_id AS tradeProviderId, ta.icon_url AS tradeIconUrl, ta.category AS tradeCategory,
      ta.last_price_cents AS tradeCurrentPriceCents, ta.change_24h AS tradeChange24h,
      (SELECT COUNT(*) FROM community_post_likes WHERE post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM community_post_comments WHERE post_id = p.id) AS comments,
      EXISTS(SELECT 1 FROM community_post_likes WHERE user_id = ? AND post_id = p.id) AS liked
    FROM community_posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN assets ra ON ra.id = p.referenced_asset_id
    LEFT JOIN trades t ON t.id = p.embedded_trade_id
    LEFT JOIN assets ta ON ta.id = t.asset_id
    WHERE 1=1 ${following}
    ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...parameters);
}

function leaderboard(viewerId, limit = 20) {
  return db.prepare(`
    SELECT u.id, u.username, u.avatar_color AS avatarColor,
      u.cash_cents + COALESCE(SUM(h.quantity * a.last_price_cents), 0) AS totalCents,
      CASE WHEN COALESCE(SUM(h.quantity * h.average_cost_cents), 0) > 0
        THEN COALESCE(SUM(h.quantity * (a.last_price_cents - h.average_cost_cents)), 0) / SUM(h.quantity * h.average_cost_cents) * 100 ELSE 0 END AS returnPercent,
      (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) AS followers,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = u.id) AS isFollowing
    FROM users u LEFT JOIN holdings h ON h.user_id = u.id LEFT JOIN assets a ON a.id = h.asset_id
    GROUP BY u.id ORDER BY totalCents DESC, followers DESC LIMIT ?
  `).all(viewerId, limit);
}

function executeTrade(userId, assetId, side, amount, sourceTradeId = null) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw new Error('Asset not found.');
  if (!['buy', 'sell'].includes(side)) throw new Error('Choose buy or sell.');
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('Enter an amount greater than zero.');
  const euroCents = side === 'buy' ? Math.round(numericAmount * 100) : Math.round(numericAmount * asset.last_price_cents);
  if (euroCents <= 0) throw new Error('Enter an amount greater than zero.');
  const quantity = side === 'buy' ? euroCents / asset.last_price_cents : numericAmount;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const holding = db.prepare('SELECT * FROM holdings WHERE user_id = ? AND asset_id = ?').get(userId, assetId);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (side === 'buy') {
      if (user.cash_cents < euroCents) throw new Error('Insufficient EUR balance.');
      db.prepare('UPDATE users SET cash_cents = cash_cents - ? WHERE id = ?').run(euroCents, userId);
      if (holding) {
        const newQuantity = holding.quantity + quantity;
        const newAverage = Math.round((holding.quantity * holding.average_cost_cents + euroCents) / newQuantity);
        db.prepare('UPDATE holdings SET quantity = ?, average_cost_cents = ? WHERE user_id = ? AND asset_id = ?').run(newQuantity, newAverage, userId, assetId);
      } else {
        db.prepare('INSERT INTO holdings(user_id, asset_id, quantity, average_cost_cents) VALUES (?, ?, ?, ?)').run(userId, assetId, quantity, asset.last_price_cents);
      }
    } else {
      if (!holding || holding.quantity + 1e-12 < quantity) throw new Error(`Insufficient ${asset.symbol} balance.`);
      db.prepare('UPDATE holdings SET quantity = quantity - ? WHERE user_id = ? AND asset_id = ?').run(quantity, userId, assetId);
      db.prepare('UPDATE users SET cash_cents = cash_cents + ? WHERE id = ?').run(euroCents, userId);
    }
    const result = db.prepare('INSERT INTO trades(user_id, asset_id, side, quantity, price_cents, total_cents, source_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, assetId, side, quantity, asset.last_price_cents, euroCents, sourceTradeId);
    db.exec('COMMIT');
    const trade = db.prepare(`SELECT t.id, t.side, t.quantity, t.price_cents AS priceCents,
      t.total_cents AS totalCents, t.created_at AS createdAt, a.id AS assetId, a.symbol,
      a.name AS assetName, a.color AS assetColor, a.provider_id AS providerId,
      a.icon_url AS iconUrl, a.category, a.last_price_cents AS currentPriceCents,
      a.change_24h AS change24h FROM trades t JOIN assets a ON a.id = t.asset_id WHERE t.id = ?`)
      .get(Number(result.lastInsertRowid));
    return trade;
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

async function api(req, res, pathname, method) {
  if (pathname === '/api/session' && method === 'GET') {
    const user = sessionUser(req);
    return json(res, 200, { user: user ? safeUser(user, user.id) : null });
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return error(res, 400, 'Username must be 3–24 letters, numbers, or underscores.');
    if (!email || !email.includes('@')) return error(res, 400, 'Enter an email address.');
    if (displayName.length < 2 || displayName.length > 40) return error(res, 400, 'Enter a display name between 2 and 40 characters.');
    if (!password) return error(res, 400, 'Enter a password.');
    if (password !== confirmPassword) return error(res, 400, 'Passwords do not match.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return error(res, 409, 'That username is already taken.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return error(res, 409, 'That email is already registered.');
    const { salt, hash } = passwordRecord(password);
    const colors = ['#78e7bc', '#8da5ff', '#ff8fb8', '#ffcf66', '#74c0fc'];
    const result = db.prepare('INSERT INTO users(username, email, wallet_address, password_hash, password_salt, display_name, avatar_color, cash_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 10000)')
      .run(username, email, generateWalletAddress(), hash, salt, displayName, colors[username.length % colors.length]);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Number(result.lastInsertRowid));
    return json(res, 201, { ok: true }, { 'set-cookie': `t1337_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.username || '').trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier.toLowerCase());
    if (!user || !verifyPassword(String(body.password || ''), user.password_salt, user.password_hash)) return error(res, 401, 'Email, username, or password is incorrect.');
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.id);
    return json(res, 200, { ok: true }, { 'set-cookie': `t1337_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).t1337_session;
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { 'set-cookie': 't1337_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (pathname === '/api/dashboard' && method === 'GET') {
    const assets = await market.getAssets();
    const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return json(res, 200, {
      user: safeUser(refreshed, user.id), portfolio: portfolioFor(user.id), assets,
      feed: feedFor(user.id, Number.MAX_SAFE_INTEGER, 5, null, true), leaderboard: leaderboard(user.id, 5),
      ownRecentTrades: db.prepare(`SELECT t.id, t.side, t.quantity, t.total_cents AS totalCents, t.created_at AS createdAt,
        t.price_cents AS priceCents, a.id AS assetId, a.symbol, a.name AS assetName,
        a.provider_id AS providerId, a.icon_url AS iconUrl, a.color AS assetColor,
        a.last_price_cents AS currentPriceCents, a.change_24h AS change24h
        FROM trades t JOIN assets a ON a.id = t.asset_id
        WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 10`).all(user.id),
      watchlist: db.prepare('SELECT asset_id AS assetId FROM watchlist WHERE user_id = ?').all(user.id).map((x) => x.assetId),
    });
  }
  if (pathname.startsWith('/api/market/') && pathname.endsWith('/history') && method === 'GET') {
    const providerId = decodeURIComponent(pathname.split('/')[3]);
    return json(res, 200, { providerId, rangeDays: 7, points: await market.getHistory(providerId) });
  }
  if (pathname === '/api/feed' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cursor = Number(url.searchParams.get('cursor')) || Number.MAX_SAFE_INTEGER;
    return json(res, 200, { items: feedFor(user.id, cursor, 12, null, true) });
  }
  if (pathname === '/api/history' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return json(res, 200, { items: historyFor(user.id, Number(url.searchParams.get('offset')) || 0, 20) });
  }
  if (pathname === '/api/community' && method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return json(res, 200, { items: communityPosts(user.id, Number(url.searchParams.get('offset')) || 0, 12, url.searchParams.get('following') === '1') });
  }
  if (pathname === '/api/community' && method === 'POST') {
    const body = await readBody(req);
    const text = String(body.body || '').trim();
    if (!text || text.length > 1000) return error(res, 400, 'Posts must be between 1 and 1000 characters.');
    const tradeId = body.tradeId ? Number(body.tradeId) : null;
    const assetId = tradeId ? null : (body.assetId ? Number(body.assetId) : null);
    if (assetId && !db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId)) return error(res, 400, 'Referenced asset not found.');
    if (tradeId && !db.prepare('SELECT 1 FROM trades WHERE id = ? AND user_id = ?').get(tradeId, user.id)) return error(res, 400, 'You can only embed one of your own trades.');
    const result = db.prepare('INSERT INTO community_posts(user_id, body, referenced_asset_id, embedded_trade_id) VALUES (?, ?, ?, ?)').run(user.id, text, assetId, tradeId);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }
  if (pathname === '/api/leaderboard' && method === 'GET') return json(res, 200, { users: leaderboard(user.id, 50) });
  if (pathname === '/api/contacts' && method === 'GET') {
    const contacts = db.prepare(`
      SELECT c.id AS contactId, u.id, u.username, u.avatar_color AS avatarColor, u.wallet_address AS walletAddress
      FROM contacts c JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.recipient_id ELSE c.requester_id END
      WHERE c.status = 'accepted' AND (c.requester_id = ? OR c.recipient_id = ?)
      ORDER BY u.username COLLATE NOCASE
    `).all(user.id, user.id, user.id);
    const incoming = db.prepare(`
      SELECT c.id AS contactId, u.id, u.username, u.avatar_color AS avatarColor, u.wallet_address AS walletAddress
      FROM contacts c JOIN users u ON u.id = c.requester_id
      WHERE c.status = 'pending' AND c.recipient_id = ? ORDER BY c.id DESC
    `).all(user.id);
    return json(res, 200, { contacts, incoming });
  }
  const walletMatch = pathname.match(/^\/api\/wallets\/(0x[a-fA-F0-9]{40})$/);
  if (walletMatch && method === 'GET') {
    const owner = db.prepare('SELECT * FROM users WHERE wallet_address = ? COLLATE NOCASE').get(walletMatch[1]);
    if (!owner) return error(res, 404, 'Wallet not found.');
    return json(res, 200, { user: safeUser(owner, user.id) });
  }
  const profileMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_]+)$/);
  if (profileMatch && method === 'GET') {
    const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(profileMatch[1]);
    if (!profile) return error(res, 404, 'Trader not found.');
    return json(res, 200, { user: safeUser(profile, user.id), portfolio: portfolioFor(profile.id), activity: feedFor(user.id, Number.MAX_SAFE_INTEGER, 10, profile.id) });
  }
  if (pathname === '/api/trades' && method === 'POST') {
    const body = await readBody(req);
    try { return json(res, 201, { trade: executeTrade(user.id, Number(body.assetId), body.side, body.amount) }); }
    catch (err) { return error(res, 400, err.message); }
  }
  if (pathname === '/api/transfers' && method === 'POST') {
    const body = await readBody(req);
    const walletAddress = String(body.walletAddress || '').trim();
    const recipient = db.prepare('SELECT * FROM users WHERE wallet_address = ? COLLATE NOCASE').get(walletAddress);
    if (!recipient || recipient.id === user.id) return error(res, 400, 'Enter another valid wallet ID.');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return error(res, 400, 'Enter a valid amount.');
    const assetId = Number(body.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) return error(res, 400, 'Choose a cryptocurrency to transfer.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const asset = db.prepare("SELECT * FROM assets WHERE id = ? AND category = 'crypto'").get(assetId);
      if (!asset) throw new Error('Only cryptocurrency can be transferred.');
      const holding = db.prepare('SELECT quantity FROM holdings WHERE user_id = ? AND asset_id = ?').get(user.id, assetId);
      if (!holding || holding.quantity < amount) throw new Error(`Insufficient ${asset.symbol} balance.`);
      db.prepare('UPDATE holdings SET quantity = quantity - ? WHERE user_id = ? AND asset_id = ?').run(amount, user.id, assetId);
      const recipientHolding = db.prepare('SELECT quantity, average_cost_cents FROM holdings WHERE user_id = ? AND asset_id = ?').get(recipient.id, assetId);
      if (recipientHolding) {
        const newQuantity = recipientHolding.quantity + amount;
        const newAverage = Math.round((recipientHolding.quantity * recipientHolding.average_cost_cents + amount * asset.last_price_cents) / newQuantity);
        db.prepare('UPDATE holdings SET quantity = ?, average_cost_cents = ? WHERE user_id = ? AND asset_id = ?').run(newQuantity, newAverage, recipient.id, assetId);
      } else {
        db.prepare('INSERT INTO holdings(user_id, asset_id, quantity, average_cost_cents) VALUES (?, ?, ?, ?)').run(recipient.id, assetId, amount, asset.last_price_cents);
      }
      db.prepare('INSERT INTO transfers(sender_id, recipient_id, asset_id, amount) VALUES (?, ?, ?, ?)').run(user.id, recipient.id, assetId, amount);
      db.exec('COMMIT');
      return json(res, 201, { ok: true });
    } catch (err) { db.exec('ROLLBACK'); return error(res, 400, err.message); }
  }
  const likeMatch = pathname.match(/^\/api\/trades\/(\d+)\/like$/);
  if (likeMatch && method === 'POST') {
    const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND trade_id = ?').get(user.id, likeMatch[1]);
    if (existing) db.prepare('DELETE FROM likes WHERE user_id = ? AND trade_id = ?').run(user.id, likeMatch[1]);
    else db.prepare('INSERT INTO likes(user_id, trade_id) VALUES (?, ?)').run(user.id, likeMatch[1]);
    return json(res, 200, { liked: !existing });
  }
  const copyMatch = pathname.match(/^\/api\/trades\/(\d+)\/copy$/);
  if (copyMatch && method === 'POST') {
    const original = db.prepare('SELECT * FROM trades WHERE id = ?').get(copyMatch[1]);
    if (!original) return error(res, 404, 'Trade not found.');
    const body = await readBody(req);
    try { return json(res, 201, { trade: executeTrade(user.id, original.asset_id, original.side, body.amount, original.id) }); }
    catch (err) { return error(res, 400, err.message); }
  }
  const commentMatch = pathname.match(/^\/api\/trades\/(\d+)\/comments$/);
  if (commentMatch && method === 'POST') {
    const body = await readBody(req); const text = String(body.body || '').trim();
    if (!text || text.length > 280) return error(res, 400, 'Comments must be between 1 and 280 characters.');
    db.prepare('INSERT INTO comments(user_id, trade_id, body) VALUES (?, ?, ?)').run(user.id, commentMatch[1], text);
    return json(res, 201, { ok: true });
  }
  if (commentMatch && method === 'GET') {
    const comments = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.trade_id = ? ORDER BY c.id DESC LIMIT 50`).all(commentMatch[1]);
    return json(res, 200, { comments });
  }
  const postLikeMatch = pathname.match(/^\/api\/community\/(\d+)\/like$/);
  if (postLikeMatch && method === 'POST') {
    const existing = db.prepare('SELECT 1 FROM community_post_likes WHERE user_id = ? AND post_id = ?').get(user.id, postLikeMatch[1]);
    if (existing) db.prepare('DELETE FROM community_post_likes WHERE user_id = ? AND post_id = ?').run(user.id, postLikeMatch[1]);
    else db.prepare('INSERT INTO community_post_likes(user_id, post_id) VALUES (?, ?)').run(user.id, postLikeMatch[1]);
    return json(res, 200, { liked: !existing });
  }
  const postCommentsMatch = pathname.match(/^\/api\/community\/(\d+)\/comments$/);
  if (postCommentsMatch && method === 'GET') {
    const comments = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
      FROM community_post_comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id DESC LIMIT 50`).all(postCommentsMatch[1]);
    return json(res, 200, { comments });
  }
  if (postCommentsMatch && method === 'POST') {
    const body = await readBody(req); const text = String(body.body || '').trim();
    if (!text || text.length > 280) return error(res, 400, 'Comments must be between 1 and 280 characters.');
    db.prepare('INSERT INTO community_post_comments(user_id, post_id, body) VALUES (?, ?, ?)').run(user.id, postCommentsMatch[1], text);
    return json(res, 201, { ok: true });
  }
  const followMatch = pathname.match(/^\/api\/users\/(\d+)\/follow$/);
  if (followMatch && method === 'POST') {
    if (Number(followMatch[1]) === user.id) return error(res, 400, 'You cannot follow yourself.');
    const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?').get(user.id, followMatch[1]);
    if (existing) db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(user.id, followMatch[1]);
    else db.prepare('INSERT INTO follows(follower_id, followed_id) VALUES (?, ?)').run(user.id, followMatch[1]);
    return json(res, 200, { following: !existing });
  }
  const contactRequestMatch = pathname.match(/^\/api\/users\/(\d+)\/contact-request$/);
  if (contactRequestMatch && method === 'POST') {
    const recipientId = Number(contactRequestMatch[1]);
    if (recipientId === user.id) return error(res, 400, 'You cannot add yourself as a contact.');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(recipientId)) return error(res, 404, 'Trader not found.');
    const existing = db.prepare(`SELECT * FROM contacts WHERE
      (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
      ORDER BY id DESC LIMIT 1`).get(user.id, recipientId, recipientId, user.id);
    if (existing?.status === 'accepted') return json(res, 200, { status: 'accepted' });
    if (existing?.status === 'pending') return json(res, 200, { status: existing.requester_id === user.id ? 'outgoing' : 'incoming' });
    db.prepare("INSERT INTO contacts(requester_id, recipient_id, status) VALUES (?, ?, 'pending')").run(user.id, recipientId);
    return json(res, 201, { status: 'outgoing' });
  }
  const acceptContactMatch = pathname.match(/^\/api\/contacts\/(\d+)\/accept$/);
  if (acceptContactMatch && method === 'POST') {
    const request = db.prepare("SELECT * FROM contacts WHERE id = ? AND recipient_id = ? AND status = 'pending'").get(acceptContactMatch[1], user.id);
    if (!request) return error(res, 404, 'Contact request not found.');
    db.prepare("UPDATE contacts SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE id = ?").run(request.id);
    return json(res, 200, { status: 'accepted' });
  }
  if (pathname === '/api/watchlist' && method === 'POST') {
    const body = await readBody(req); const assetId = Number(body.assetId);
    const existing = db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND asset_id = ?').get(user.id, assetId);
    if (existing) db.prepare('DELETE FROM watchlist WHERE user_id = ? AND asset_id = ?').run(user.id, assetId);
    else db.prepare('INSERT INTO watchlist(user_id, asset_id) VALUES (?, ?)').run(user.id, assetId);
    return json(res, 200, { watching: !existing });
  }
  return error(res, 404, 'API route not found.');
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.resolve(publicDir, requested);
  if ((filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname, req.method);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    return error(res, err.message === 'Invalid JSON body.' ? 400 : 500, err.message === 'Invalid JSON body.' ? err.message : 'Something went wrong.');
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  market.startHistoryRefresh();
  server.listen(port, host, () => console.log(`Trading 1337 running at http://${host}:${port}`));
  const shutdown = () => server.close(() => { market.stopHistoryRefresh(); db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { db, handleRequest };
