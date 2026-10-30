function createCommunityQueries(db) {
  function communityPosts(viewerId, offset = 0, limit = 12, followedOnly = false, ids = null) {
    if (ids && !ids.length) return [];
    const following = followedOnly ? 'AND EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followed_id = p.user_id)' : '';
    const selected = ids ? `AND p.id IN (${ids.map(() => '?').join(',')})` : '';
    const parameters = [viewerId, ...(followedOnly ? [viewerId] : []), ...(ids || []), limit, offset];
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
        p.like_count AS likes, p.comment_count AS comments,
        EXISTS(SELECT 1 FROM community_post_likes WHERE user_id = ? AND post_id = p.id) AS liked
      FROM community_posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN assets ra ON ra.id = p.referenced_asset_id
      LEFT JOIN trades t ON t.id = p.embedded_trade_id
      LEFT JOIN assets ta ON ta.id = t.asset_id
      WHERE 1=1 ${following} ${selected}
      ORDER BY p.id DESC LIMIT ? OFFSET ?
    `).all(...parameters);
  }

  const assetExistsStatement = db.prepare('SELECT 1 FROM assets WHERE id = ?');
  function assetExists(assetId) {
    return assetExistsStatement.get(assetId);
  }

  const ownsTradeStatement = db.prepare('SELECT 1 FROM trades WHERE id = ? AND user_id = ?');
  function ownsTrade(tradeId, userId) {
    return ownsTradeStatement.get(tradeId, userId);
  }

  const insertPostStatement = db.prepare('INSERT INTO community_posts(user_id, body, referenced_asset_id, embedded_trade_id) VALUES (?, ?, ?, ?)');
  function insertPost(userId, body, assetId, tradeId) {
    return insertPostStatement.run(userId, body, assetId, tradeId);
  }

  const likeExistsStatement = db.prepare('SELECT 1 FROM community_post_likes WHERE user_id = ? AND post_id = ?');
  function likeExists(userId, postId) {
    return likeExistsStatement.get(userId, postId);
  }

  const deleteLikeStatement = db.prepare('DELETE FROM community_post_likes WHERE user_id = ? AND post_id = ?');
  function deleteLike(userId, postId) {
    return deleteLikeStatement.run(userId, postId);
  }

  const insertLikeStatement = db.prepare('INSERT INTO community_post_likes(user_id, post_id) VALUES (?, ?)');
  function insertLike(userId, postId) {
    return insertLikeStatement.run(userId, postId);
  }

  const commentsStatement = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
    FROM community_post_comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.id < ? ORDER BY c.id DESC LIMIT 11`);
  function comments(postId, cursor = Number.MAX_SAFE_INTEGER) {
    return commentsStatement.all(postId, cursor);
  }

  const commentByIdStatement = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.username, u.avatar_color AS avatarColor
    FROM community_post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`);
  function commentById(id) { return commentByIdStatement.get(id); }
  const commentTotalStatement = db.prepare('SELECT comment_count AS total FROM community_posts WHERE id = ?');
  function commentTotal(postId) { return commentTotalStatement.get(postId); }

  const insertCommentStatement = db.prepare('INSERT INTO community_post_comments(user_id, post_id, body) VALUES (?, ?, ?)');
  function insertComment(userId, postId, body) {
    return insertCommentStatement.run(userId, postId, body);
  }

  return { communityPosts, assetExists, ownsTrade, insertPost, likeExists, deleteLike, insertLike, comments, insertComment, commentById, commentTotal };
}

module.exports = { createCommunityQueries };
