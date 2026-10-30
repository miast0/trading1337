const { json, readBody } = require('../http');

function registerMarketsRoutes(router, { queries, market }) {
  router.add('GET', /^\/api\/market\/([^/]+)\/history$/, async ({ res, params }) => {
    const providerId = decodeURIComponent(params[0]);
    return json(res, 200, { providerId, rangeDays: 7, points: await market.getHistory(providerId) });
  });

  router.add('POST', '/api/watchlist', async ({ req, res, user }) => {
    const body = await readBody(req); const assetId = Number(body.assetId);
    const existing = queries.portfolio.watchExists(user.id, assetId);
    if (existing) queries.portfolio.deleteWatch(user.id, assetId);
    else queries.portfolio.insertWatch(user.id, assetId);
    return json(res, 200, { watching: !existing });
  });
}

module.exports = { registerMarketsRoutes };
