const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('./db');
const { avatarColor } = require('./services/avatar');

function normalizeSeed(input) {
  const seed = structuredClone(input);
  if (!Array.isArray(seed?.users)) return seed;
  seed.transfers ||= [];
  for (const user of seed.users) {
    for (const post of user.posts || []) if (post.trade) post.body ??= '';
    for (const field of ['holdings', 'watchlist', 'followers', 'follows', 'trades', 'posts', 'transfers']) user[field] ??= [];
    for (const item of [...user.trades, ...user.posts]) {
      item.likes ??= [];
      item.comments ??= [];
      for (const comment of item.comments) comment.username ??= user.username;
    }
    for (const transfer of user.transfers) seed.transfers.push({ ...transfer, from: transfer.from || user.username, to: transfer.to || user.username });
  }
  return seed;
}

function isDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function requireDate(value, label) {
  if (!isDate(value)) throw new Error(`${label} must be an absolute ISO date.`);
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer of at least ${minimum}.`);
}

function requireNumber(value, label, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${label} must be a number of at least ${minimum}.`);
}

function validateEngagement(items, label, usernames) {
  for (const item of items || []) {
    if (!usernames.has(item.username)) throw new Error(`${label} references unknown user ${item.username}.`);
    requireDate(item.createdAt, `${label} date`);
    if ('body' in item && (!item.body || typeof item.body !== 'string')) throw new Error(`${label} requires comment text.`);
  }
}

function validateSeed(seed, existingUsernames = []) {
  seed = normalizeSeed(seed);
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Seed must be a JSON object.');
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(seed.name || '')) throw new Error('Seed name must use lowercase letters, numbers, dashes, or underscores.');
  if (!Array.isArray(seed.users) || !seed.users.length) throw new Error('Seed requires at least one user.');
  if (seed.transfers !== undefined && !Array.isArray(seed.transfers)) throw new Error('Seed transfers must be an array.');

  const usernames = new Set();
  const emails = new Set();
  const wallets = new Set();
  const tradeKeys = new Set();
  const postKeys = new Set();

  for (const user of seed.users) {
    if (!/^[a-z0-9_]{3,24}$/.test(user.username || '')) throw new Error(`Invalid username: ${user.username || '(missing)'}.`);
    if (usernames.has(user.username)) throw new Error(`Duplicate username: ${user.username}.`);
    if (typeof user.email !== 'string' || !user.email.includes('@')) throw new Error(`Invalid email for ${user.username}.`);
    if (emails.has(user.email.toLowerCase())) throw new Error(`Duplicate email: ${user.email}.`);
    if (!/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress || '')) throw new Error(`Invalid wallet address for ${user.username}.`);
    if (wallets.has(user.walletAddress.toLowerCase())) throw new Error(`Duplicate wallet address for ${user.username}.`);
    const hasPassword = typeof user.password === 'string' && user.password.length > 0;
    const hasStoredPassword = /^[a-fA-F0-9]{128}$/.test(user.passwordHash || '') && /^[a-fA-F0-9]+$/.test(user.passwordSalt || '');
    if (!hasPassword && !hasStoredPassword) throw new Error(`Password or stored password hash is required for ${user.username}.`);
    if (typeof user.name !== 'string' || !user.name) throw new Error(`Name is required for ${user.username}.`);
    if (typeof user.bio !== 'string') throw new Error(`Bio must be text for ${user.username}.`);
    requireInteger(user.cashCents, `${user.username} cashCents`);
    requireDate(user.createdAt, `${user.username} createdAt`);
    for (const field of ['followerCount', 'followingCount', 'tradeCount', 'postCount']) {
      if (user[field] !== undefined) requireInteger(user[field], `${user.username} ${field}`);
    }
    for (const field of ['holdings', 'watchlist', 'follows', 'trades', 'posts']) {
      if (!Array.isArray(user[field])) throw new Error(`${user.username} ${field} must be an array.`);
    }
    usernames.add(user.username);
    emails.add(user.email.toLowerCase());
    wallets.add(user.walletAddress.toLowerCase());

    for (const holding of user.holdings) {
      if (!holding.asset) throw new Error(`Holding for ${user.username} requires an asset.`);
      requireNumber(holding.quantity, `${user.username} ${holding.asset} holding quantity`, Number.EPSILON);
      requireInteger(holding.averageCostCents, `${user.username} ${holding.asset} averageCostCents`, 1);
    }
    for (const watched of user.watchlist) {
      if (!watched.asset) throw new Error(`Watchlist entry for ${user.username} requires an asset.`);
      requireDate(watched.createdAt, `${user.username} ${watched.asset} watchlist date`);
    }
    for (const trade of user.trades) {
      for (const field of ['likeCount', 'commentCount', 'copyCount']) if (trade[field] !== undefined) requireInteger(trade[field], `${trade.key} ${field}`);
      if (!trade.key || tradeKeys.has(trade.key)) throw new Error(`Trade keys must be present and unique: ${trade.key || '(missing)'}.`);
      if (!['buy', 'sell'].includes(trade.side)) throw new Error(`Invalid side for trade ${trade.key}.`);
      requireNumber(trade.quantity, `${trade.key} quantity`, Number.EPSILON);
      requireInteger(trade.priceCents, `${trade.key} priceCents`, 1);
      requireInteger(trade.totalCents, `${trade.key} totalCents`, 1);
      requireDate(trade.createdAt, `${trade.key} createdAt`);
      if (!Array.isArray(trade.likes) || !Array.isArray(trade.comments)) throw new Error(`${trade.key} likes and comments must be arrays.`);
      tradeKeys.add(trade.key);
    }
    for (const post of user.posts) {
      for (const field of ['likeCount', 'commentCount']) if (post[field] !== undefined) requireInteger(post[field], `${post.key} ${field}`);
      if (!post.key || postKeys.has(post.key)) throw new Error(`Post keys must be present and unique: ${post.key || '(missing)'}.`);
      if (typeof post.body !== 'string' || (!post.body.trim() && !post.trade)) throw new Error(`Post ${post.key} requires text or a trade.`);
      if (post.asset && post.trade) throw new Error(`Post ${post.key} cannot reference both a market and a trade.`);
      requireDate(post.createdAt, `${post.key} createdAt`);
      if (!Array.isArray(post.likes) || !Array.isArray(post.comments)) throw new Error(`${post.key} likes and comments must be arrays.`);
      postKeys.add(post.key);
    }
  }

  for (const username of existingUsernames) usernames.add(username);
  for (const user of seed.users) {
    for (const follow of [...user.follows, ...user.followers]) {
      if (!usernames.has(follow.username) || follow.username === user.username) throw new Error(`Invalid follow from ${user.username} to ${follow.username}.`);
      requireDate(follow.createdAt, `${user.username} follow date`);
    }
    for (const trade of user.trades) {
      if (trade.copiedFrom && !tradeKeys.has(trade.copiedFrom)) throw new Error(`Trade ${trade.key} copies unknown trade ${trade.copiedFrom}.`);
      validateEngagement(trade.likes, `${trade.key} like`, usernames);
      validateEngagement(trade.comments, `${trade.key} comment`, usernames);
    }
    for (const post of user.posts) {
      if (post.trade && !tradeKeys.has(post.trade)) throw new Error(`Post ${post.key} references unknown trade ${post.trade}.`);
      if (post.trade && !user.trades.some((trade) => trade.key === post.trade)) throw new Error(`Post ${post.key} can only reference a trade owned by ${user.username}.`);
      validateEngagement(post.likes, `${post.key} like`, usernames);
      validateEngagement(post.comments, `${post.key} comment`, usernames);
    }
  }

  for (const transfer of seed.transfers || []) {
    if (!usernames.has(transfer.from) || !usernames.has(transfer.to) || transfer.from === transfer.to) throw new Error('Transfer must reference two different existing or seeded users.');
    if (!transfer.asset) throw new Error('Transfer requires an asset.');
    requireNumber(transfer.quantity, `Transfer ${transfer.from} to ${transfer.to} quantity`, Number.EPSILON);
    requireDate(transfer.createdAt, `Transfer ${transfer.from} to ${transfer.to} createdAt`);
  }
}

function passwordRecord(seedName, username, password) {
  const salt = crypto.createHash('sha256').update(`${seedName}:${username}:password`).digest('hex').slice(0, 32);
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function clearSeedAccounts(db, userIds) {
  if (!userIds.length) return;
  const slots = placeholders(userIds);
  const ownedTrades = `SELECT id FROM trades WHERE user_id IN (${slots})`;
  db.prepare(`UPDATE trades SET source_trade_id = NULL WHERE source_trade_id IN (${ownedTrades})`).run(...userIds);
  db.prepare(`DELETE FROM community_posts WHERE user_id IN (${slots})`).run(...userIds);
  db.prepare(`DELETE FROM follows WHERE follower_id IN (${slots}) OR followed_id IN (${slots})`).run(...userIds, ...userIds);
  db.prepare(`DELETE FROM transfers WHERE sender_id IN (${slots}) OR recipient_id IN (${slots})`).run(...userIds, ...userIds);
  db.prepare(`DELETE FROM watchlist WHERE user_id IN (${slots})`).run(...userIds);
  db.prepare(`DELETE FROM trades WHERE user_id IN (${slots})`).run(...userIds);
  db.prepare(`DELETE FROM holdings WHERE user_id IN (${slots})`).run(...userIds);
}

function applySeed(db, seed) {
  const existingUsers = db.prepare('SELECT id, username FROM users').all();
  validateSeed(seed, existingUsers.map((user) => user.username));
  seed = normalizeSeed(seed);
  const assets = new Map(db.prepare('SELECT * FROM assets').all().map((asset) => [asset.symbol, asset]));
  if (!assets.size) throw new Error('The application database has no markets. Start the application once before applying a seed.');
  const assetFor = (symbol, context) => {
    const asset = assets.get(symbol);
    if (!asset) throw new Error(`${context} references unsupported asset ${symbol}.`);
    return asset;
  };
  seed.users.forEach((user) => {
    user.holdings.forEach((item) => assetFor(item.asset, `${user.username} holding`));
    user.watchlist.forEach((item) => assetFor(item.asset, `${user.username} watchlist`));
    user.trades.forEach((trade) => assetFor(trade.asset, trade.key));
    user.posts.forEach((post) => { if (post.asset) assetFor(post.asset, post.key); });
  });
  (seed.transfers || []).forEach((transfer) => {
    const asset = assetFor(transfer.asset, `Transfer from ${transfer.from}`);
    if (asset.category !== 'crypto') throw new Error(`Transfers can only use cryptocurrency assets: ${transfer.asset}.`);
  });

  const userIds = new Map(existingUsers.map((user) => [user.username, user.id]));
  const tradeIds = new Map();
  const postIds = new Map();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existingEmail = db.prepare('SELECT id, username FROM users WHERE email = ? COLLATE NOCASE');
    const existingWallet = db.prepare('SELECT id, username FROM users WHERE wallet_address = ? COLLATE NOCASE');
    const upsertUser = db.prepare(`INSERT INTO users
      (username, email, wallet_address, password_hash, password_salt, display_name, bio, avatar_color, cash_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET email = excluded.email, wallet_address = excluded.wallet_address,
        password_hash = excluded.password_hash, password_salt = excluded.password_salt,
        display_name = excluded.display_name, bio = excluded.bio, avatar_color = excluded.avatar_color,
        cash_cents = excluded.cash_cents, created_at = excluded.created_at`);
    for (const user of seed.users) {
      const current = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(user.username);
      const emailOwner = existingEmail.get(user.email);
      const walletOwner = existingWallet.get(user.walletAddress);
      if (emailOwner && emailOwner.id !== current?.id) throw new Error(`Email ${user.email} already belongs to @${emailOwner.username}.`);
      if (walletOwner && walletOwner.id !== current?.id) throw new Error(`Wallet ${user.walletAddress} already belongs to @${walletOwner.username}.`);
      const password = user.password
        ? passwordRecord(seed.name, user.username, user.password)
        : { hash: user.passwordHash.toLowerCase(), salt: user.passwordSalt.toLowerCase() };
      upsertUser.run(user.username, user.email.toLowerCase(), user.walletAddress.toLowerCase(), password.hash, password.salt,
        user.name, user.bio, avatarColor(user.username), user.cashCents, user.createdAt);
      userIds.set(user.username, db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(user.username).id);
    }

    clearSeedAccounts(db, seed.users.map((user) => userIds.get(user.username)));

    const insertHolding = db.prepare('INSERT INTO holdings(user_id, asset_id, quantity, average_cost_cents) VALUES (?, ?, ?, ?)');
    const insertWatch = db.prepare('INSERT INTO watchlist(user_id, asset_id, created_at) VALUES (?, ?, ?)');
    const insertTrade = db.prepare(`INSERT INTO trades
      (user_id, asset_id, side, quantity, price_cents, total_cents, source_trade_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`);
    for (const user of seed.users) {
      const userId = userIds.get(user.username);
      user.holdings.forEach((holding) => insertHolding.run(userId, assetFor(holding.asset, 'Holding').id, holding.quantity, holding.averageCostCents));
      user.watchlist.forEach((item) => insertWatch.run(userId, assetFor(item.asset, 'Watchlist').id, item.createdAt));
      for (const trade of user.trades) {
        const result = insertTrade.run(userId, assetFor(trade.asset, trade.key).id, trade.side, trade.quantity,
          trade.priceCents, trade.totalCents, trade.createdAt);
        tradeIds.set(trade.key, Number(result.lastInsertRowid));
      }
    }

    const setCopiedTrade = db.prepare('UPDATE trades SET source_trade_id = ? WHERE id = ?');
    seed.users.forEach((user) => user.trades.forEach((trade) => {
      if (trade.copiedFrom) setCopiedTrade.run(tradeIds.get(trade.copiedFrom), tradeIds.get(trade.key));
    }));

    const insertFollow = db.prepare('INSERT OR IGNORE INTO follows(follower_id, followed_id, created_at) VALUES (?, ?, ?)');
    for (const user of seed.users) {
      user.follows.forEach((follow) => insertFollow.run(userIds.get(user.username), userIds.get(follow.username), follow.createdAt));
      user.followers.forEach((follow) => insertFollow.run(userIds.get(follow.username), userIds.get(user.username), follow.createdAt));
    }

    const insertTransfer = db.prepare('INSERT INTO transfers(sender_id, recipient_id, asset_id, amount, created_at) VALUES (?, ?, ?, ?, ?)');
    (seed.transfers || []).forEach((transfer) => insertTransfer.run(userIds.get(transfer.from), userIds.get(transfer.to),
      assetFor(transfer.asset, 'Transfer').id, transfer.quantity, transfer.createdAt));

    const insertTradeLike = db.prepare('INSERT INTO likes(user_id, trade_id, created_at) VALUES (?, ?, ?)');
    const insertTradeComment = db.prepare('INSERT INTO comments(user_id, trade_id, body, created_at) VALUES (?, ?, ?, ?)');
    for (const user of seed.users) {
      for (const trade of user.trades) {
        const tradeId = tradeIds.get(trade.key);
        trade.likes.forEach((like) => insertTradeLike.run(userIds.get(like.username), tradeId, like.createdAt));
        trade.comments.forEach((comment) => insertTradeComment.run(userIds.get(comment.username), tradeId, comment.body, comment.createdAt));
      }
    }

    const insertPost = db.prepare(`INSERT INTO community_posts
      (user_id, body, referenced_asset_id, embedded_trade_id, created_at) VALUES (?, ?, ?, ?, ?)`);
    for (const user of seed.users) {
      for (const post of user.posts) {
        const result = insertPost.run(userIds.get(user.username), post.body,
          post.asset ? assetFor(post.asset, post.key).id : null, post.trade ? tradeIds.get(post.trade) : null, post.createdAt);
        postIds.set(post.key, Number(result.lastInsertRowid));
      }
    }

    const insertPostLike = db.prepare('INSERT INTO community_post_likes(user_id, post_id, created_at) VALUES (?, ?, ?)');
    const insertPostComment = db.prepare('INSERT INTO community_post_comments(user_id, post_id, body, created_at) VALUES (?, ?, ?, ?)');
    for (const user of seed.users) {
      for (const post of user.posts) {
        const postId = postIds.get(post.key);
        post.likes.forEach((like) => insertPostLike.run(userIds.get(like.username), postId, like.createdAt));
        post.comments.forEach((comment) => insertPostComment.run(userIds.get(comment.username), postId, comment.body, comment.createdAt));
      }
    }

    // Counts are exact totals, including any explicitly listed relationships.
    // Omitted counts use the rows actually supplied; no accounts are invented.
    const setCount = (table, id, column, value, child, foreignKey) => {
      const actual = db.prepare(`SELECT COUNT(*) AS total FROM ${child} WHERE ${foreignKey} = ?`).get(id).total;
      if (value !== undefined && value < actual) throw new Error(`${table} ${id} ${column} cannot be less than its ${actual} listed records.`);
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value ?? actual, id);
    };
    for (const user of seed.users) {
      const id = userIds.get(user.username);
      setCount('users', id, 'follower_count', user.followerCount, 'follows', 'followed_id');
      setCount('users', id, 'following_count', user.followingCount, 'follows', 'follower_id');
      setCount('users', id, 'trade_count', user.tradeCount, 'trades', 'user_id');
      setCount('users', id, 'post_count', user.postCount, 'community_posts', 'user_id');
      for (const trade of user.trades) {
        const tradeId = tradeIds.get(trade.key);
        setCount('trades', tradeId, 'like_count', trade.likeCount, 'likes', 'trade_id');
        setCount('trades', tradeId, 'comment_count', trade.commentCount, 'comments', 'trade_id');
        setCount('trades', tradeId, 'copy_count', trade.copyCount, 'trades', 'source_trade_id');
      }
      for (const post of user.posts) {
        const postId = postIds.get(post.key);
        setCount('community_posts', postId, 'like_count', post.likeCount, 'community_post_likes', 'post_id');
        setCount('community_posts', postId, 'comment_count', post.commentCount, 'community_post_comments', 'post_id');
      }
    }
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error('Seed would leave invalid database references.');
    db.exec('COMMIT');
    return {
      name: seed.name,
      users: seed.users.length,
      holdings: seed.users.reduce((count, user) => count + user.holdings.length, 0),
      trades: tradeIds.size,
      posts: postIds.size,
      transfers: (seed.transfers || []).length,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function resetDatabase(db) {
  db.exec(`BEGIN IMMEDIATE;
    DELETE FROM community_post_likes;
    DELETE FROM community_post_comments;
    DELETE FROM community_posts;
    DELETE FROM likes;
    DELETE FROM comments;
    DELETE FROM follows;
    DELETE FROM transfers;
    DELETE FROM watchlist;
    DELETE FROM trades;
    DELETE FROM holdings;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('users','trades','transfers','comments','community_posts','community_post_comments');
    COMMIT;`);
}

function exportSeed(db, name) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name || '')) throw new Error('Export name must use lowercase letters, numbers, dashes, or underscores.');
  const assets = new Map(db.prepare('SELECT id, symbol FROM assets').all().map((asset) => [asset.id, asset.symbol]));
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const usernames = new Map(users.map((user) => [user.id, user.username]));
  const trades = db.prepare('SELECT * FROM trades ORDER BY id').all();
  const tradeKeys = new Map(trades.map((trade) => [trade.id, `${usernames.get(trade.user_id)}_trade_${trade.id}`]));
  const posts = db.prepare('SELECT * FROM community_posts ORDER BY id').all();
  const postKeys = new Map(posts.map((post) => [post.id, `${usernames.get(post.user_id)}_post_${post.id}`]));

  const snapshotUsers = users.map((user) => ({
    username: user.username,
    email: user.email,
    passwordHash: user.password_hash,
    passwordSalt: user.password_salt,
    name: user.display_name,
    walletAddress: user.wallet_address,
    bio: user.bio,
    cashCents: user.cash_cents,
    followerCount: user.follower_count,
    followingCount: user.following_count,
    tradeCount: user.trade_count,
    postCount: user.post_count,
    createdAt: user.created_at,
    holdings: db.prepare(`SELECT a.symbol AS asset, h.quantity, h.average_cost_cents AS averageCostCents
      FROM holdings h JOIN assets a ON a.id = h.asset_id WHERE h.user_id = ? ORDER BY a.symbol`).all(user.id),
    watchlist: db.prepare(`SELECT a.symbol AS asset, w.created_at AS createdAt
      FROM watchlist w JOIN assets a ON a.id = w.asset_id WHERE w.user_id = ? ORDER BY w.rowid`).all(user.id),
    follows: db.prepare(`SELECT followed.username, f.created_at AS createdAt
      FROM follows f JOIN users followed ON followed.id = f.followed_id WHERE f.follower_id = ? ORDER BY followed.username`).all(user.id),
    transfers: db.prepare(`SELECT recipient.username AS "to", a.symbol AS asset,
      t.amount AS quantity, t.created_at AS createdAt FROM transfers t
      JOIN users recipient ON recipient.id = t.recipient_id JOIN assets a ON a.id = t.asset_id
      WHERE t.sender_id = ? ORDER BY t.id`).all(user.id),
    trades: trades.filter((trade) => trade.user_id === user.id).map((trade) => ({
      key: tradeKeys.get(trade.id),
      asset: assets.get(trade.asset_id),
      side: trade.side,
      quantity: trade.quantity,
      priceCents: trade.price_cents,
      totalCents: trade.total_cents,
      likeCount: trade.like_count,
      commentCount: trade.comment_count,
      copyCount: trade.copy_count,
      ...(trade.source_trade_id ? { copiedFrom: tradeKeys.get(trade.source_trade_id) } : {}),
      createdAt: trade.created_at,
      likes: db.prepare(`SELECT liker.username, l.created_at AS createdAt
        FROM likes l JOIN users liker ON liker.id = l.user_id WHERE l.trade_id = ? ORDER BY l.created_at, l.user_id`).all(trade.id),
      comments: db.prepare(`SELECT commenter.username, c.body, c.created_at AS createdAt
        FROM comments c JOIN users commenter ON commenter.id = c.user_id WHERE c.trade_id = ? ORDER BY c.id`).all(trade.id),
    })),
    posts: posts.filter((post) => post.user_id === user.id).map((post) => ({
      key: postKeys.get(post.id),
      body: post.body,
      likeCount: post.like_count,
      commentCount: post.comment_count,
      ...(post.referenced_asset_id ? { asset: assets.get(post.referenced_asset_id) } : {}),
      ...(post.embedded_trade_id ? { trade: tradeKeys.get(post.embedded_trade_id) } : {}),
      createdAt: post.created_at,
      likes: db.prepare(`SELECT liker.username, l.created_at AS createdAt
        FROM community_post_likes l JOIN users liker ON liker.id = l.user_id WHERE l.post_id = ? ORDER BY l.created_at, l.user_id`).all(post.id),
      comments: db.prepare(`SELECT commenter.username, c.body, c.created_at AS createdAt
        FROM community_post_comments c JOIN users commenter ON commenter.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(post.id),
    })),
  }));

  return {
    name,
    users: snapshotUsers,
  };
}

function openSeedDatabase() {
  const dataDir = path.resolve(process.env.DATA_DIR || '/app/data');
  const databasePath = path.join(dataDir, 'trading1337.sqlite');
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

if (require.main === module) {
  let db;
  try {
    db = openSeedDatabase();
    if (process.argv[2] === '--export') {
      process.stdout.write(`${JSON.stringify(exportSeed(db, process.argv[3]), null, 2)}\n`);
    } else if (process.argv[2] === '--reset') {
      resetDatabase(db);
      console.log('Database reset complete. Markets and cached market history were preserved.');
    } else {
      const source = process.argv[2];
      if (!source) throw new Error('Provide a seed JSON file or pipe one using -');
      const contents = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(source), 'utf8');
      const result = applySeed(db, JSON.parse(contents));
      console.log(`Applied ${result.name}: ${result.users} users, ${result.holdings} holdings, ${result.trades} trades, ${result.posts} posts, ${result.transfers} transfers.`);
    }
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

module.exports = { applySeed, exportSeed, resetDatabase, validateSeed };
