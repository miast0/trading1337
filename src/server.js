const http = require('node:http');
const { openDatabase } = require('./db');
const { MarketService } = require('./market');
const { createApp } = require('./app');

const db = openDatabase();
const market = new MarketService(db);
const handleRequest = createApp(db, market);

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = http.createServer(handleRequest);
  market.startHistoryRefresh();
  server.listen(port, host, () => console.log(`Trading 1337 running at http://${host}:${port}`));
  const shutdown = () => server.close(() => { market.stopHistoryRefresh(); db.close(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { db, handleRequest };
