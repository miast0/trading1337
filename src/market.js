const CRYPTO_ICON_ROOT = 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color';
// Fixed sandbox fallback metrics in EUR, used only when the provider has no value.
const MARKET_METRIC_FALLBACKS = {
  BTC: [1200000000000, 22000000000], ETH: [250000000000, 12000000000],
  USDT: [160000000000, 50000000000], BNB: [80000000000, 1400000000],
  SOL: [50000000000, 2600000000], USDC: [65000000000, 6000000000],
  XRP: [70000000000, 1800000000], ADA: [16000000000, 350000000],
  DOGE: [20000000000, 700000000], AVAX: [8000000000, 200000000],
  LINK: [9000000000, 250000000], DOT: [6000000000, 130000000],
};
const ASSET_CATALOG = [
  { symbol: 'BTC', providerId: 'bitcoin', name: 'Bitcoin', color: '#f7931a', priceCents: 6400000, iconUrl: `${CRYPTO_ICON_ROOT}/btc.svg` },
  { symbol: 'ETH', providerId: 'ethereum', name: 'Ethereum', color: '#627eea', priceCents: 245000, iconUrl: `${CRYPTO_ICON_ROOT}/eth.svg` },
  { symbol: 'USDT', providerId: 'tether', name: 'Tether', color: '#26a17b', priceCents: 92, iconUrl: `${CRYPTO_ICON_ROOT}/usdt.svg` },
  { symbol: 'BNB', providerId: 'binancecoin', name: 'BNB', color: '#f3ba2f', priceCents: 57000, iconUrl: `${CRYPTO_ICON_ROOT}/bnb.svg` },
  { symbol: 'SOL', providerId: 'solana', name: 'Solana', color: '#14f195', priceCents: 14320, iconUrl: `${CRYPTO_ICON_ROOT}/sol.svg` },
  { symbol: 'USDC', providerId: 'usd-coin', name: 'USDC', color: '#2775ca', priceCents: 92, iconUrl: `${CRYPTO_ICON_ROOT}/usdc.svg` },
  { symbol: 'XRP', providerId: 'ripple', name: 'XRP', color: '#23a2e1', priceCents: 52, iconUrl: `${CRYPTO_ICON_ROOT}/xrp.svg` },
  { symbol: 'ADA', providerId: 'cardano', name: 'Cardano', color: '#2a6edb', priceCents: 34, iconUrl: `${CRYPTO_ICON_ROOT}/ada.svg` },
  { symbol: 'DOGE', providerId: 'dogecoin', name: 'Dogecoin', color: '#c2a633', priceCents: 11, iconUrl: `${CRYPTO_ICON_ROOT}/doge.svg` },
  { symbol: 'AVAX', providerId: 'avalanche-2', name: 'Avalanche', color: '#e84142', priceCents: 2780, iconUrl: `${CRYPTO_ICON_ROOT}/avax.svg` },
  { symbol: 'LINK', providerId: 'chainlink', name: 'Chainlink', color: '#2a5ada', priceCents: 1270, iconUrl: `${CRYPTO_ICON_ROOT}/link.svg` },
  { symbol: 'DOT', providerId: 'polkadot', name: 'Polkadot', color: '#e6007a', priceCents: 620, iconUrl: `${CRYPTO_ICON_ROOT}/dot.svg` },
  { symbol: 'XAU', providerId: 'pax-gold', name: 'Gold', color: '#d4af37', priceCents: 360000, category: 'commodity', iconUrl: 'https://api.iconify.design/game-icons:gold-bar.svg?color=%23d4af37' },
  { symbol: 'XAG', providerId: 'kinesis-silver', name: 'Silver', color: '#c0c7cf', priceCents: 5400, category: 'commodity', iconUrl: 'https://api.iconify.design/game-icons:metal-bar.svg?color=%23c0c7cf' },
  { symbol: 'DDR5', providerId: 'ramradar:ddr5', name: 'DDR5 RAM per GB', color: '#78e7bc', priceCents: 1450, category: 'memory', source: 'RamRadar RAM Price Index', iconUrl: '/assets/markets/ram.png' },
  { symbol: 'DDR4', providerId: 'ramradar:ddr4', name: 'DDR4 RAM per GB', color: '#8da5ff', priceCents: 670, category: 'memory', source: 'RamRadar RAM Price Index', iconUrl: '/assets/markets/ram.png' },
].map((asset) => ({ category: 'crypto', source: 'CoinGecko', ...asset }));

function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ''])));
}

function fieldMatching(record, expressions) {
  const key = Object.keys(record).find((candidate) => expressions.some((expression) => expression.test(candidate)));
  return key ? record[key] : '';
}

class MarketService {
  constructor(db) {
    this.db = db;
    this.cacheUntil = 0;
    this.refreshMs = Number(process.env.MARKET_REFRESH_MS || 60000);
    this.historyRefreshMs = Number(process.env.MARKET_HISTORY_REFRESH_MS || 3600000);
    this.historyRequestDelayMs = Number(process.env.MARKET_HISTORY_REQUEST_DELAY_MS || 1200);
    this.historyRequests = new Map();
    this.historyQueue = Promise.resolve();
    this.historyTimer = null;
    this.coinGeckoRequest = null;
    this.baseUrl = process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3';
    this.ramRadarUrl = process.env.RAMRADAR_CSV_URL || 'https://ramradar.app/ram-price-index/data.csv';
    this.fxUrl = process.env.FX_API_URL || 'https://api.frankfurter.app/latest?from=USD&to=EUR';
    this.ramCache = null;
    this.syncCatalog();
  }

  syncCatalog() {
    const insert = this.db.prepare(`INSERT INTO assets(symbol, provider_id, name, color, category, source, icon_url, last_price_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET provider_id = excluded.provider_id,
      name = excluded.name, color = excluded.color, category = excluded.category, source = excluded.source,
      icon_url = CASE WHEN excluded.category = 'memory' OR assets.icon_url = '' THEN excluded.icon_url ELSE assets.icon_url END`);
    ASSET_CATALOG.forEach((asset) => insert.run(asset.symbol, asset.providerId, asset.name, asset.color, asset.category, asset.source, asset.iconUrl, asset.priceCents));
  }

  listFromDatabase() {
    return this.db.prepare(`
      SELECT id, symbol, provider_id AS providerId, name, color, category, source, icon_url AS iconUrl,
             last_price_cents AS priceCents, change_24h AS change24h, updated_at AS updatedAt,
             market_cap_cents AS marketCapCents, volume_24h_cents AS volume24hCents, change_7d AS change7d
      FROM assets ORDER BY id
    `).all().map((asset) => {
      const fallback = MARKET_METRIC_FALLBACKS[asset.symbol];
      return { ...asset,
        marketCapCents: asset.marketCapCents ?? (fallback ? fallback[0] * 100 : null),
        volume24hCents: asset.volume24hCents ?? (fallback ? fallback[1] * 100 : null),
      };
    });
  }

  async getAssets() {
    if (Date.now() < this.cacheUntil) return this.listFromDatabase();
    const results = await Promise.allSettled([this.refreshCoinGeckoMarkets(), this.refreshRamAssets()]);
    results.filter((result) => result.status === 'rejected')
      .forEach((result) => console.warn(`[market] Using cached market data: ${result.reason.message}`));
    this.cacheUntil = Date.now() + (results.some((result) => result.status === 'fulfilled') ? this.refreshMs : Math.min(this.refreshMs, 15000));
    return this.listFromDatabase();
  }

  async refreshCoinGeckoMarkets() {
    if (this.coinGeckoRequest) return this.coinGeckoRequest;
    this.coinGeckoRequest = (async () => {
      const assets = this.listFromDatabase().filter((asset) => asset.source === 'CoinGecko');
      const ids = assets.map((asset) => asset.providerId).join(',');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${this.baseUrl}/coins/markets?vs_currency=eur&ids=${encodeURIComponent(ids)}&price_change_percentage=24h,7d`, {
          signal: controller.signal,
          headers: { accept: 'application/json', 'user-agent': 'Trading1337/0.1' },
        });
        if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
        const data = await response.json();
        const quotes = new Map(data.map((quote) => [quote.id, quote]));
        const update = this.db.prepare(`UPDATE assets SET last_price_cents = ?, change_24h = ?,
          icon_url = COALESCE(NULLIF(?, ''), icon_url), updated_at = ?,
          market_cap_cents = ?, volume_24h_cents = ?, change_7d = ? WHERE id = ?`);
        const metric = (value, multiplier = 1) => typeof value === 'number' && Number.isFinite(value) ? value * multiplier : null;
        const now = new Date().toISOString();
        for (const asset of assets) {
          const quote = quotes.get(asset.providerId);
          if (!quote || !Number.isFinite(Number(quote.current_price))) continue;
          update.run(Math.round(Number(quote.current_price) * 100), Number(quote.price_change_percentage_24h || 0), quote.image || '', now,
            asset.category === 'crypto' ? metric(quote.market_cap, 100) : null,
            asset.category === 'crypto' ? metric(quote.total_volume, 100) : null,
            metric(quote.price_change_percentage_7d_in_currency), asset.id);
        }
        return data.length;
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => { this.coinGeckoRequest = null; });
    return this.coinGeckoRequest;
  }

  async fetchCoinGeckoHistory(providerId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${this.baseUrl}/coins/${encodeURIComponent(providerId)}/market_chart?vs_currency=eur&days=7`, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'Trading1337/0.1' },
      });
      if (!response.ok) throw new Error(`CoinGecko returned ${response.status} for ${providerId}`);
      const data = await response.json();
      const points = Array.isArray(data.prices) ? data.prices.map(([time, price]) => ({ time: Number(time), price: Number(price) }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0) : [];
      if (points.length < 2) throw new Error(`CoinGecko returned no price history for ${providerId}`);
      this.writeHistoryCache(providerId, points);
      return points;
    } finally {
      clearTimeout(timer);
    }
  }

  queueCoinGeckoHistory(providerId, force = false) {
    if (this.historyRequests.has(providerId)) return this.historyRequests.get(providerId);
    const queued = this.historyQueue.then(async () => {
      const cached = this.readHistoryCache(providerId);
      if (!force && cached?.points.length && Date.now() - cached.fetchedAt < this.historyRefreshMs) return cached.points;
      try {
        return await this.fetchCoinGeckoHistory(providerId);
      } finally {
        if (this.historyRequestDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.historyRequestDelayMs));
      }
    });
    this.historyQueue = queued.catch(() => {});
    const request = queued.finally(() => this.historyRequests.delete(providerId));
    this.historyRequests.set(providerId, request);
    return request;
  }

  async usdToEur() {
    try {
      const response = await fetch(this.fxUrl, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json', 'user-agent': 'Trading1337/0.1' } });
      if (!response.ok) throw new Error('FX rate unavailable');
      const data = await response.json();
      return Number(data.rates?.EUR) || Number(process.env.USD_EUR_RATE) || 0.86;
    } catch { return Number(process.env.USD_EUR_RATE) || 0.86; }
  }

  async ramSeries() {
    if (this.ramCache && Date.now() < this.ramCache.expires) return this.ramCache;
    const [response, rate] = await Promise.all([
      fetch(this.ramRadarUrl, { signal: AbortSignal.timeout(5000), headers: { accept: 'text/csv', 'user-agent': 'Trading1337/0.1' } }),
      this.usdToEur(),
    ]);
    if (!response.ok) throw new Error(`RamRadar returned ${response.status}`);
    const records = parseCsv(await response.text()).map((record) => {
      const type = fieldMatching(record, [/^ram_type$/, /^memory_type$/, /^type$/]).toUpperCase();
      const form = fieldMatching(record, [/form_factor/, /^form$/]).toUpperCase();
      const date = fieldMatching(record, [/^date$/, /recorded_at/, /day/]);
      const mean = Number(fieldMatching(record, [/^avg_price_per_gb$/, /mean.*(price|usd|gb)/, /average.*(price|usd|gb)/, /^mean$/, /^average$/]));
      return { type, form, date, price: mean * rate };
    }).filter((record) => ['DDR4', 'DDR5'].includes(record.type) && record.form === 'DIMM' && record.date && Number.isFinite(record.price) && record.price > 0)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    this.ramCache = { records, rate, expires: Date.now() + this.refreshMs };
    return this.ramCache;
  }

  async refreshRamAssets(forceHistory = false) {
    const { records } = await this.ramSeries();
    const update = this.db.prepare("UPDATE assets SET last_price_cents = ?, change_24h = ?, updated_at = ? WHERE provider_id = ?");
    for (const type of ['DDR4', 'DDR5']) {
      const series = records.filter((record) => record.type === type);
      if (!series.length) continue;
      const latest = series.at(-1); const previous = series.at(-2) || latest;
      const change = previous.price ? ((latest.price / previous.price) - 1) * 100 : 0;
      const providerId = `ramradar:${type.toLowerCase()}`;
      update.run(Math.round(latest.price * 100), change, new Date().toISOString(), providerId);
      const cached = this.readHistoryCache(providerId);
      if (forceHistory || !cached?.points.length || Date.now() - cached.fetchedAt >= this.historyRefreshMs) {
        const cutoff = Date.now() - 7 * 86400000;
        this.writeHistoryCache(providerId, series.filter((record) => new Date(record.date).getTime() >= cutoff)
          .map((record) => ({ time: new Date(record.date).getTime(), price: record.price })));
      }
    }
  }

  async getHistory(providerId) {
    const safeProviderId = String(providerId || '');
    if (!safeProviderId) return [];
    const asset = this.listFromDatabase().find((item) => item.providerId === safeProviderId);
    if (!asset) return [];
    const cached = this.readHistoryCache(safeProviderId);
    if (cached?.points.length && Date.now() - cached.fetchedAt < this.historyRefreshMs) return cached.points;
    if (asset.source === 'CoinGecko') {
      const refresh = this.queueCoinGeckoHistory(safeProviderId, true);
      if (cached?.points.length) {
        refresh.catch((error) => console.warn(`[market] History refresh failed for ${safeProviderId}: ${error.message}`));
        return cached.points;
      }
      return refresh.catch(() => []);
    }
    try {
      await this.refreshRamAssets(true);
      return this.readHistoryCache(safeProviderId)?.points || cached?.points || [];
    } catch {
      return cached?.points || [];
    }
  }

  readHistoryCache(providerId) {
    const row = this.db.prepare('SELECT points_json AS pointsJson, fetched_at AS fetchedAt FROM market_history_cache WHERE provider_id = ?').get(providerId);
    if (!row) return null;
    try {
      const points = JSON.parse(row.pointsJson);
      return Array.isArray(points) ? { points, fetchedAt: Number(row.fetchedAt) } : null;
    } catch { return null; }
  }

  writeHistoryCache(providerId, points) {
    this.db.prepare(`INSERT INTO market_history_cache(provider_id, points_json, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET points_json = excluded.points_json, fetched_at = excluded.fetched_at`)
      .run(providerId, JSON.stringify(points), Date.now());
  }

  async refreshAllHistories() {
    const providers = this.listFromDatabase().filter((asset) => asset.source === 'CoinGecko').map((asset) => asset.providerId);
    const results = await Promise.allSettled([
      ...providers.map((providerId) => this.queueCoinGeckoHistory(providerId, true)),
      this.refreshRamAssets(true),
    ]);
    results.forEach((result, index) => {
      if (result.status === 'rejected') console.warn(`[market] History refresh failed for ${providers[index] || 'RamRadar'}: ${result.reason.message}`);
    });
  }

  startHistoryRefresh() {
    if (this.historyTimer) return;
    const refresh = () => this.refreshAllHistories().catch((error) => console.warn(`[market] History refresh failed: ${error.message}`));
    refresh();
    this.historyTimer = setInterval(refresh, this.historyRefreshMs);
    this.historyTimer.unref();
  }

  stopHistoryRefresh() {
    if (this.historyTimer) clearInterval(this.historyTimer);
    this.historyTimer = null;
  }

}

module.exports = { MarketService };
