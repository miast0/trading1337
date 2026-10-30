function createActivityService(queries) {
  function publishedActivity(userId, viewerId, offset = 0, limit = 12) {
    const keys = queries.users.activityKeys(userId, offset, limit + 1);
    const page = keys.slice(0, limit);
    const tradeIds = page.filter((item) => item.kind === 'trade').map((item) => item.id);
    const postIds = page.filter((item) => item.kind === 'post').map((item) => item.id);
    const trades = queries.trades.feedFor(viewerId, Number.MAX_SAFE_INTEGER, limit, userId, false, tradeIds);
    const posts = queries.community.communityPosts(viewerId, 0, limit, false, postIds);
    const records = new Map([
      ...trades.map((item) => [`trade-${item.id}`, item]),
      ...posts.map((item) => [`post-${item.id}`, item]),
    ]);
    return {
      items: page.map((key) => ({ ...records.get(`${key.kind}-${key.id}`), activityType: key.kind })),
      hasMore: keys.length > limit,
    };
  }

  return { publishedActivity };
}

module.exports = { createActivityService };
