const { json, error, readBody } = require('../http');
const { passwordRecord, generateWalletAddress } = require('../db');
const { avatarColor } = require('../services/avatar');

function registerRegistrationRoute(router, { queries, auth }) {
  router.add('POST', '/api/auth/register', async ({ req, res }) => {
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
    if (queries.registration.usernameExists(username)) return error(res, 409, 'That username is already taken.');
    if (queries.registration.emailExists(email)) return error(res, 409, 'That email is already registered.');
    const { salt, hash } = passwordRecord(password);
    const result = queries.registration.insertUser(username, email, generateWalletAddress(), hash, salt, displayName, avatarColor(username));
    const token = auth.createSession(Number(result.lastInsertRowid));
    return json(res, 201, { ok: true }, { 'set-cookie': `t1337_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
  }, { public: true });
}

module.exports = { registerRegistrationRoute };
