const { json, error, readBody } = require('../http');

function registerTransfersRoutes(router, { transfer }) {
  router.add('POST', '/api/transfers', async ({ req, res, user }) => {
    const body = await readBody(req);
    try {
      transfer(user.id, body);
      return json(res, 201, { ok: true });
    } catch (err) { return error(res, 400, err.message); }
  });
}

module.exports = { registerTransfersRoutes };
