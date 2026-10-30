const path = require('node:path');
const { json, error } = require('./http');
const { Router } = require('./router');
const { createQueries } = require('./queries');
const { createAuthService } = require('./services/auth');
const { createTradingService } = require('./services/trading');
const { createActivityService } = require('./services/activity');
const { createStaticHandler } = require('./static');
const { registerAuthRoutes } = require('./routes/auth');
const { registerDashboardRoutes } = require('./routes/dashboard');
const { registerMarketsRoutes } = require('./routes/markets');
const { registerTradesRoutes } = require('./routes/trades');
const { registerCommunityRoutes } = require('./routes/community');
const { registerUsersRoutes } = require('./routes/users');
const { registerTransfersRoutes } = require('./routes/transfers');
const { registerProfileRoutes } = require('./routes/profile');
const { registerSearchRoutes } = require('./routes/search');

function createApp(db, market) {
  const queries = createQueries(db);
  const auth = createAuthService(queries.users);
  const { executeTrade, transfer } = createTradingService(db, queries);
  const { publishedActivity } = createActivityService(queries);
  const router = new Router(auth);
  const context = { queries, market, auth, executeTrade, transfer, publishedActivity };
  registerAuthRoutes(router, context);
  registerDashboardRoutes(router, context);
  registerMarketsRoutes(router, context);
  registerTradesRoutes(router, context);
  registerCommunityRoutes(router, context);
  registerUsersRoutes(router, context);
  registerTransfersRoutes(router, context);
  registerProfileRoutes(router, context);
  registerSearchRoutes(router, context);
  const serveStatic = createStaticHandler(path.join(__dirname, '..', 'public'));

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
      if (url.pathname.startsWith('/api/')) return await router.handle(req, res, url);
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      console.error(err);
      return error(res, err.message === 'Invalid JSON body.' ? 400 : 500, err.message === 'Invalid JSON body.' ? err.message : 'Something went wrong.');
    }
  }

  return handleRequest;
}

module.exports = { createApp };
