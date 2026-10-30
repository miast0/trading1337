const { json, error, readBody } = require('../http');
const { verifyPassword } = require('../db');

function registerLoginRoute(router, { queries, auth }) {
  router.add('POST', '/api/auth/login', async ({ req, res }) => {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.username || '').trim();
    const account = queries.login.findForLogin(identifier, identifier.toLowerCase());
    if (!account || !verifyPassword(String(body.password || ''), account.password_salt, account.password_hash)) return error(res, 401, 'Email, username, or password is incorrect.');
    const token = auth.createSession(account.id);
    return json(res, 200, { ok: true }, { 'set-cookie': `t1337_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
  }, { public: true });
}

module.exports = { registerLoginRoute };
