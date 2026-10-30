const { json, error, readBody } = require('../http');

function registerTradesRoutes(router, { queries, executeTrade }) {
  router.add('GET', '/api/feed', async ({ res, user, url }) => {
    const cursor = Number(url.searchParams.get('cursor')) || Number.MAX_SAFE_INTEGER;
    return json(res, 200, { items: queries.trades.feedFor(user.id, cursor, 12, null, true) });
  });

  router.add('GET', '/api/history', async ({ res, user, url }) => {
    return json(res, 200, { items: queries.trades.historyFor(user.id, Number(url.searchParams.get('offset')) || 0, 20) });
  });

  router.add('POST', '/api/trades', async ({ req, res, user }) => {
    const body = await readBody(req);
    try { return json(res, 201, { trade: executeTrade(user.id, Number(body.assetId), body.side, body.amount) }); }
    catch (err) { return error(res, 400, err.message); }
  });

  router.add('POST', /^\/api\/trades\/(\d+)\/like$/, async ({ res, user, params }) => {
    const existing = queries.trades.likeExists(user.id, params[0]);
    if (existing) queries.trades.deleteLike(user.id, params[0]);
    else queries.trades.insertLike(user.id, params[0]);
    return json(res, 200, { liked: !existing });
  });

  router.add('POST', /^\/api\/trades\/(\d+)\/copy$/, async ({ req, res, user, params }) => {
    const original = queries.trades.findById(params[0]);
    if (!original) return error(res, 404, 'Trade not found.');
    const body = await readBody(req);
    try { return json(res, 201, { trade: executeTrade(user.id, original.asset_id, original.side, body.amount, original.id) }); }
    catch (err) { return error(res, 400, err.message); }
  });

  router.add('POST', /^\/api\/trades\/(\d+)\/comments$/, async ({ req, res, user, params }) => {
    const body = await readBody(req); const text = String(body.body || '').trim();
    if (!text || text.length > 280) return error(res, 400, 'Comments must be between 1 and 280 characters.');
    if (!queries.trades.commentTotal(params[0])) return error(res, 404, 'Trade not found.');
    const result = queries.trades.insertComment(user.id, params[0], text);
    return json(res, 201, { ok: true, comment: queries.trades.commentById(Number(result.lastInsertRowid)), total: queries.trades.commentTotal(params[0]).total });
  });

  router.add('GET', /^\/api\/trades\/(\d+)\/comments$/, async ({ res, params, url }) => {
    const total = queries.trades.commentTotal(params[0]);
    if (!total) return error(res, 404, 'Trade not found.');
    const cursor = Number(url.searchParams.get('cursor')) || Number.MAX_SAFE_INTEGER;
    const rows = queries.trades.comments(params[0], cursor);
    const comments = rows.slice(0, 10);
    return json(res, 200, { comments, hasMore: rows.length > 10, nextCursor: comments.at(-1)?.id || null, total: total.total });
  });
}

module.exports = { registerTradesRoutes };
