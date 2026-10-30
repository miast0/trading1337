const { json } = require('../http');

function registerDashboardRoutes(router, { queries, market }) {
  router.add('GET', '/api/dashboard', async ({ res, user }) => {
    const assets = await market.getAssets();
    const refreshed = queries.portfolio.refreshedUser(user.id);
    return json(res, 200, {
      user: queries.users.safeUser(refreshed, user.id), portfolio: queries.portfolio.portfolioFor(user.id), assets,
      feed: queries.trades.feedFor(user.id, Number.MAX_SAFE_INTEGER, 5, null, true), leaderboard: queries.users.leaderboard(user.id, 5),
      ownRecentTrades: queries.portfolio.recentTrades(user.id),
      watchlist: queries.portfolio.watchlist(user.id).map((x) => x.assetId),
    });
  });
}

module.exports = { registerDashboardRoutes };
