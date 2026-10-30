function createProfileQueries(db) {
  const emailOwnerStatement = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE');
  function emailOwner(email) { return emailOwnerStatement.get(email); }

  const updateStatement = db.prepare(`UPDATE users SET email = ?, display_name = ?, bio = ?,
    password_hash = ?, password_salt = ? WHERE id = ?`);
  function update(userId, email, displayName, bio, hash, salt) {
    updateStatement.run(email, displayName, bio, hash, salt, userId);
  }

  return { emailOwner, update };
}

module.exports = { createProfileQueries };
