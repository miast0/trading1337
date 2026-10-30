const { json, parseCookies } = require('../http');
const { registerLoginRoute } = require('./login');
const { registerRegistrationRoute } = require('./registration');

function registerAuthRoutes(router, context) {
  const { queries, auth } = context;
  registerRegistrationRoute(router, context);
  registerLoginRoute(router, context);

  router.add('GET', '/api/session', async ({ req, res }) => {
    const currentUser = auth.sessionUser(req);
    return json(res, 200, { user: currentUser ? queries.users.safeUser(currentUser, currentUser.id) : null });
  }, { public: true });

  router.add('POST', '/api/auth/logout', async ({ req, res }) => {
    const token = parseCookies(req.headers.cookie).t1337_session;
    if (token) auth.deleteSession(token);
    return json(res, 200, { ok: true }, { 'set-cookie': 't1337_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }, { public: true });
}

module.exports = { registerAuthRoutes };
