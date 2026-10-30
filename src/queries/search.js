function createSearchQueries(db) {
  const usersStatement = db.prepare(`SELECT username, avatar_color AS avatarColor,
    follower_count AS followers FROM users
    WHERE username LIKE ? ESCAPE '\\'
    ORDER BY CASE WHEN username = ? COLLATE NOCASE THEN 0 ELSE 1 END,
      follower_count DESC, username COLLATE NOCASE LIMIT ? OFFSET ?`);

  function users(term, offset = 0, limit = 20) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = usersStatement.all(pattern, term, limit + 1, offset);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  return { users };
}

module.exports = { createSearchQueries };
