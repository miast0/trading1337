const { json, error, readBody } = require('../http');

function registerCommunityRoutes(router, { queries }) {
  router.add('GET', '/api/community', async ({ res, user, url }) => {
    return json(res, 200, { items: queries.community.communityPosts(user.id, Number(url.searchParams.get('offset')) || 0, 12, url.searchParams.get('following') === '1') });
  });

  router.add('POST', '/api/community', async ({ req, res, user }) => {
    const body = await readBody(req);
    const text = String(body.body || '').trim();
    const tradeId = body.tradeId ? Number(body.tradeId) : null;
    if ((!text && !tradeId) || text.length > 1000) return error(res, 400, text.length > 1000 ? 'Posts must be at most 1000 characters.' : 'Write a message to post.');
    const assetId = tradeId ? null : (body.assetId ? Number(body.assetId) : null);
    if (assetId && !queries.community.assetExists(assetId)) return error(res, 400, 'Referenced asset not found.');
    if (tradeId && !queries.community.ownsTrade(tradeId, user.id)) return error(res, 400, 'You can only embed one of your own trades.');
    const result = queries.community.insertPost(user.id, text, assetId, tradeId);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  });

  router.add('POST', /^\/api\/community\/(\d+)\/like$/, async ({ res, user, params }) => {
    const existing = queries.community.likeExists(user.id, params[0]);
    if (existing) queries.community.deleteLike(user.id, params[0]);
    else queries.community.insertLike(user.id, params[0]);
    return json(res, 200, { liked: !existing });
  });

  router.add('GET', /^\/api\/community\/(\d+)\/comments$/, async ({ res, params, url }) => {
    const total = queries.community.commentTotal(params[0]);
    if (!total) return error(res, 404, 'Post not found.');
    const cursor = Number(url.searchParams.get('cursor')) || Number.MAX_SAFE_INTEGER;
    const rows = queries.community.comments(params[0], cursor);
    const comments = rows.slice(0, 10);
    return json(res, 200, { comments, hasMore: rows.length > 10, nextCursor: comments.at(-1)?.id || null, total: total.total });
  });

  router.add('POST', /^\/api\/community\/(\d+)\/comments$/, async ({ req, res, user, params }) => {
    const body = await readBody(req); const text = String(body.body || '').trim();
    if (!text || text.length > 280) return error(res, 400, 'Comments must be between 1 and 280 characters.');
    if (!queries.community.commentTotal(params[0])) return error(res, 404, 'Post not found.');
    const result = queries.community.insertComment(user.id, params[0], text);
    return json(res, 201, { ok: true, comment: queries.community.commentById(Number(result.lastInsertRowid)), total: queries.community.commentTotal(params[0]).total });
  });
}

module.exports = { registerCommunityRoutes };
