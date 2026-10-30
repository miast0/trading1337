function createUsersQueries(db) {
  function safeUser(user, viewerId = null) {
    const counts = db.prepare(`
      SELECT
        follower_count AS followers, following_count AS following, trade_count AS trades, post_count AS posts,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?) AS isFollowing
      FROM users WHERE id = ?
    `).get(viewerId || -1, user.id, user.id);
    return {
      id: user.id, username: user.username, displayName: user.display_name, bio: user.bio,
      ...(viewerId === user.id ? { email: user.email } : {}),
      walletAddress: user.wallet_address,
      avatarColor: user.avatar_color, createdAt: user.created_at,
      ...counts,
    };
  }

  function leaderboard(viewerId, limit = 20) {
    return db.prepare(`
      SELECT u.id, u.username, u.avatar_color AS avatarColor,
        u.cash_cents + COALESCE(SUM(h.quantity * a.last_price_cents), 0) AS totalCents,
        CASE WHEN COALESCE(SUM(h.quantity * h.average_cost_cents), 0) > 0
          THEN COALESCE(SUM(h.quantity * (a.last_price_cents - h.average_cost_cents)), 0) / SUM(h.quantity * h.average_cost_cents) * 100 ELSE 0 END AS returnPercent,
        u.follower_count AS followers,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = u.id) AS isFollowing
      FROM users u LEFT JOIN holdings h ON h.user_id = u.id LEFT JOIN assets a ON a.id = h.asset_id
      GROUP BY u.id ORDER BY totalCents DESC, followers DESC LIMIT ?
    `).all(viewerId, limit);
  }

  const findByWalletStatement = db.prepare('SELECT * FROM users WHERE wallet_address = ? COLLATE NOCASE');
  function findByWallet(walletAddress) {
    return findByWalletStatement.get(walletAddress);
  }

  const findByUsernameStatement = db.prepare('SELECT * FROM users WHERE username = ?');
  function findByUsername(username) {
    return findByUsernameStatement.get(username);
  }

  const followExistsStatement = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?');
  function followExists(followerId, followedId) {
    return followExistsStatement.get(followerId, followedId);
  }

  const deleteFollowStatement = db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?');
  function deleteFollow(followerId, followedId) {
    return deleteFollowStatement.run(followerId, followedId);
  }

  const insertFollowStatement = db.prepare('INSERT INTO follows(follower_id, followed_id) VALUES (?, ?)');
  function insertFollow(followerId, followedId) {
    return insertFollowStatement.run(followerId, followedId);
  }

  const findByIdStatement = db.prepare('SELECT * FROM users WHERE id = ?');
  function findById(userId) { return findByIdStatement.get(userId); }

  const activityKeysStatement = db.prepare(`SELECT * FROM (
    SELECT 'trade' AS kind, id, created_at FROM trades WHERE user_id = ?
    UNION ALL
    SELECT 'post' AS kind, id, created_at FROM community_posts WHERE user_id = ?
  ) ORDER BY datetime(created_at) DESC, kind DESC, id DESC LIMIT ? OFFSET ?`);
  function activityKeys(userId, offset, limit) {
    return activityKeysStatement.all(userId, userId, limit, offset);
  }

  const followingStatement = db.prepare(`SELECT u.id, u.username,
    u.avatar_color AS avatarColor, u.wallet_address AS walletAddress
    FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ? ORDER BY u.username COLLATE NOCASE`);
  function following(userId) { return followingStatement.all(userId); }

  return { safeUser, leaderboard, findByWallet, findByUsername, followExists, deleteFollow, insertFollow, findById, activityKeys, following };
}

module.exports = { createUsersQueries };
