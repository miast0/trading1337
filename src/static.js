const fs = require('node:fs');
const path = require('node:path');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function createStaticHandler(publicDir) {
  function serveStatic(req, res, pathname) {
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const filePath = path.resolve(publicDir, requested);
    if ((filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(filePath).pipe(res);
  }
  return serveStatic;
}

module.exports = { createStaticHandler };
