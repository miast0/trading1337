function createLoginQueries(db) {
  const findForLoginStatement = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?');
  function findForLogin(identifier, email) {
    return findForLoginStatement.get(identifier, email);
  }

  return { findForLogin };
}

module.exports = { createLoginQueries };
