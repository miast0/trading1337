function createRegistrationQueries(db) {
  const usernameExistsStatement = db.prepare('SELECT 1 FROM users WHERE username = ?');
  function usernameExists(username) {
    return usernameExistsStatement.get(username);
  }

  const emailExistsStatement = db.prepare('SELECT 1 FROM users WHERE email = ?');
  function emailExists(email) {
    return emailExistsStatement.get(email);
  }

  const insertUserStatement = db.prepare('INSERT INTO users(username, email, wallet_address, password_hash, password_salt, display_name, avatar_color, cash_cents) VALUES (?, ?, ?, ?, ?, ?, ?, 10000)');
  function insertUser(username, email, walletAddress, hash, salt, displayName, color) {
    return insertUserStatement.run(username, email, walletAddress, hash, salt, displayName, color);
  }

  return { usernameExists, emailExists, insertUser };
}

module.exports = { createRegistrationQueries };
