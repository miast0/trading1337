const { json } = require('../http');

function registerSearchRoutes(router, { queries, market }) {
  router.add('GET', '/api/search', async ({ res, url }) => {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (!query) return json(res, 200, { query, markets: [], users: [], hasMoreUsers: false });
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
    const term = query.toLowerCase().replace(/^@/, '');
    const markets = market.listFromDatabase().filter((asset) =>
      `${asset.name} ${asset.symbol}`.toLowerCase().includes(query.toLowerCase()));
    const users = queries.search.users(term, offset);
    return json(res, 200, { query, markets, users: users.items, hasMoreUsers: users.hasMore });
  });
}

module.exports = { registerSearchRoutes };
