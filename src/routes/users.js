const { json, error } = require('../http');

function registerUsersRoutes(router, { queries, publishedActivity }) {
  router.add('GET', '/api/following', async ({ res, user }) => {
    return json(res, 200, { users: queries.users.following(user.id) });
  });

  router.add('GET', '/api/leaderboard', async ({ res, user }) => {
    return json(res, 200, { users: queries.users.leaderboard(user.id) });
  });

  router.add('GET', /^\/api\/wallets\/(0x[a-fA-F0-9]{40})$/, async ({ res, user, params }) => {
    const owner = queries.users.findByWallet(params[0]);
    if (!owner) return error(res, 404, 'Wallet not found.');
    return json(res, 200, { user: queries.users.safeUser(owner, user.id) });
  });

  router.add('GET', /^\/api\/users\/([a-zA-Z0-9_]+)$/, async ({ res, user, params }) => {
    const profile = queries.users.findByUsername(params[0]);
    if (!profile) return error(res, 404, 'Trader not found.');
    const page = publishedActivity(profile.id, user.id);
    return json(res, 200, { user: queries.users.safeUser(profile, user.id), portfolio: queries.portfolio.portfolioFor(profile.id), activity: page.items, hasMore: page.hasMore });
  });

  router.add('GET', /^\/api\/users\/([a-zA-Z0-9_]+)\/activity$/, async ({ res, user, params, url }) => {
    const profile = queries.users.findByUsername(params[0]);
    if (!profile) return error(res, 404, 'Trader not found.');
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
    return json(res, 200, publishedActivity(profile.id, user.id, offset));
  });

  router.add('POST', /^\/api\/users\/(\d+)\/follow$/, async ({ res, user, params }) => {
    if (Number(params[0]) === user.id) return error(res, 400, 'You cannot follow yourself.');
    if (!queries.users.findById(Number(params[0]))) return error(res, 404, 'Trader not found.');
    const existing = queries.users.followExists(user.id, params[0]);
    if (existing) queries.users.deleteFollow(user.id, params[0]);
    else queries.users.insertFollow(user.id, params[0]);
    return json(res, 200, { following: !existing });
  });
}

module.exports = { registerUsersRoutes };
