const crypto = require('node:crypto');
const { parseCookies, error } = require('../http');

function createAuthService(users) {
  const sessions = new Map();

  function sessionUser(req) {
    const token = parseCookies(req.headers.cookie).t1337_session;
    const userId = token && sessions.get(token);
    return userId ? users.findById(userId) : null;
  }

  function requireUser(req, res) {
    const user = sessionUser(req);
    if (!user) error(res, 401, 'Sign in to continue.');
    return user;
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, userId);
    return token;
  }

  function deleteSession(token) { sessions.delete(token); }

  return { sessionUser, requireUser, createSession, deleteSession };
}

module.exports = { createAuthService };
