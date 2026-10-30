const { error } = require('./http');

class Router {
  constructor(auth) {
    this.auth = auth;
    this.routes = [];
  }

  add(method, path, handler, options = {}) {
    this.routes.push({ method, path, handler, public: options.public === true });
  }

  async handle(req, res, url) {
    let matched;
    let params = [];
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const result = typeof route.path === 'string'
        ? route.path === url.pathname
        : route.path.exec(url.pathname);
      if (!result) continue;
      matched = route;
      params = Array.isArray(result) ? result.slice(1) : [];
      break;
    }
    const user = matched?.public ? null : this.auth.requireUser(req, res);
    if (!matched?.public && !user) return;
    if (!matched) return error(res, 404, 'API route not found.');
    return matched.handler({ req, res, url, user, params });
  }
}

module.exports = { Router };
