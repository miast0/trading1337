function createTradesQueries(db) {
  function feedFor(viewerId, cursor = Number.MAX_SAFE_INTEGER, limit = 12, authorId = null, recentOnly = false, ids = null) {
    if (ids && !ids.length) return [];
    const selected = ids ? `AND t.id IN (${ids.map(() => '?').join(',')})` : '';
    return db.prepare(`
      SELECT t.id, t.side, t.quantity, t.price_cents AS priceCents, t.total_cents AS totalCents,
        t.created_at AS createdAt, t.source_trade_id AS sourceTradeId,
        u.id AS userId, u.username, u.avatar_color AS avatarColor,
        a.id AS assetId, a.symbol, a.name AS assetName, a.color AS assetColor,
        a.provider_id AS providerId, a.icon_url AS iconUrl, a.category, a.change_24h AS change24h,
        a.last_price_cents AS currentPriceCents,
        t.like_count AS likes, t.comment_count AS comments, t.copy_count AS copies,
        EXISTS(SELECT 1 FROM likes WHERE user_id = ? AND trade_id = t.id) AS liked
      FROM trades t JOIN users u ON u.id = t.user_id JOIN assets a ON a.id = t.asset_id
      WHERE t.id < ? AND (? IS NULL OR t.user_id = ?)
        AND (? = 0 OR datetime(t.created_at) >= datetime('now', '-7 days'))
        ${selected}
      ORDER BY t.id DESC LIMIT ?
    `).all(viewerId, cursor, authorId, authorId, recentOnly ? 1 : 0, ...(ids || []), limit);
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

  const likeExistsStatement = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND trade_id = ?');
  function likeExists(userId, tradeId) {
    return likeExistsStatement.get(userId, tradeId);
  }

  const deleteLikeStatement = db.prepare('DELETE FROM likes WHERE user_id = ? AND trade_id = ?');
  function deleteLike(userId, tradeId) {
    return deleteLikeStatement.run(userId, tradeId);
  }

  const insertLikeStatement = db.prepare('INSERT INTO likes(user_id, trade_id) VALUES (?, ?)');
  function insertLike(userId, tradeId) {
    return insertLikeStatement.run(userId, tradeId);
  }

  const findByIdStatement = db.prepare('SELECT * FROM trades WHERE id = ?');
  function findById(tradeId) {
    return findByIdStatement.get(tradeId);
  }

  const insertCommentStatement = db.prepare('INSERT INTO comments(user_id, trade_id, body) VALUES (?, ?, ?)');
  function insertComment(userId, tradeId, body) {
    return insertCommentStatement.run(userId, tradeId, body);
  }

  const commentsStatement = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.trade_id = ? AND c.id < ? ORDER BY c.id DESC LIMIT 11`);
  function comments(tradeId, cursor = Number.MAX_SAFE_INTEGER) {
    return commentsStatement.all(tradeId, cursor);
  }

  const commentByIdStatement = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`);
  function commentById(id) { return commentByIdStatement.get(id); }
  const commentTotalStatement = db.prepare('SELECT comment_count AS total FROM trades WHERE id = ?');
  function commentTotal(tradeId) { return commentTotalStatement.get(tradeId); }

  return { feedFor, historyFor, likeExists, deleteLike, insertLike, findById, insertComment, comments, commentById, commentTotal };
}

module.exports = { createTradesQueries };
