const state = {
  user: null, dashboard: null, route: 'home', feedCursor: null, historyOffset: 0,
  feedItems: [], historyItems: [], communityItems: [], communityOffset: 0,
  leaderboard: [], leaderboardSort: { key: 'totalCents', direction: 'desc' },
  infiniteObserver: null, search: '', marketFilter: 'all', historyFilter: 'all',
  chartCache: new Map(),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const h = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const money = (cents, digits = 2) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(cents || 0) / 100);
const quantity = (value) => Number(value || 0).toLocaleString('en-IE', { maximumFractionDigits: 8 });
const pct = (value) => `${Number(value || 0) >= 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const initials = (name) => String(name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('');
const shortWallet = (address) => address ? `${address.slice(0, 8)}…${address.slice(-6)}` : '—';
const allocationColors = ['#78e7bc', '#8da5ff', '#f5a94f', '#ff8fb8', '#8bd3dd', '#c7a6ff', '#ff8a72', '#b8d66b'];
const ago = (date) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(date).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;
  item.textContent = message;
  $('#toast-root').append(item);
  setTimeout(() => item.remove(), 3500);
}

function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) { button.dataset.label = button.innerHTML; button.innerHTML = label; button.disabled = true; }
  else { button.innerHTML = button.dataset.label || button.innerHTML; button.disabled = false; }
}

function avatar(person, size = '') {
  return `<span class="avatar ${size}" style="--avatar:${h(person.avatarColor)}">${h(initials(person.username))}</span>`;
}

function coin(asset) {
  const iconUrl = asset.iconUrl || asset.assetIconUrl;
  return `<span class="coin" style="--coin:${h(asset.color || asset.assetColor)}"><img src="${h(iconUrl)}" alt="${h(asset.symbol)} logo" loading="lazy"></span>`;
}

function assetPrice(asset) {
  const digits = asset.priceCents < 100 ? 4 : asset.priceCents < 10000 ? 2 : 0;
  return money(asset.priceCents, digits);
}

const actionIcon = (name) => ({
  like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>',
}[name]);

function graphAsset(asset) {
  return {
    id: asset.id || asset.assetId,
    symbol: asset.symbol,
    name: asset.name || asset.assetName,
    color: asset.color || asset.assetColor,
    iconUrl: asset.iconUrl || asset.assetIconUrl,
    providerId: asset.providerId,
    priceCents: asset.priceCents ?? asset.currentPriceCents,
    change24h: asset.change24h || 0,
    category: asset.category,
  };
}

function tradePerformance(trade) {
  const current = Number(trade.currentPriceCents || trade.priceCents);
  const entry = Number(trade.priceCents || 0);
  const direction = trade.side === 'sell' ? -1 : 1;
  const value = (current - entry) * Number(trade.quantity || 0) * direction;
  const percent = entry ? ((current / entry) - 1) * 100 * direction : 0;
  return { cents: Math.round(value), percent };
}

function marketEmbed(assetInput, marker = null) {
  const asset = graphAsset(assetInput);
  const performance = marker ? tradePerformance({ ...marker, currentPriceCents: asset.priceCents }) : null;
  return `<section class="market-embed">
    <button class="market-embed-head" data-asset="${asset.id}">
      <span class="asset-name">${coin(asset)}<span><b>${h(asset.name)}</b><small>${h(asset.symbol)}${asset.category === 'memory' ? ' · per GB' : ''}</small></span></span>
      <span class="market-embed-quote"><b>${assetPrice(asset)}</b><small class="${Number(asset.change24h) >= 0 ? 'positive' : 'negative'}">${pct(asset.change24h)} today</small></span>
    </button>
    <div class="inline-chart" data-market-chart data-provider="${h(asset.providerId)}" data-change="${Number(asset.change24h)}"${marker ? ` data-marker-time="${h(marker.createdAt)}"` : ''}><span class="chart-loader"></span></div>
    ${marker ? `<div class="trade-chart-details"><div><span>${marker.side === 'buy' ? 'Purchased' : 'Sold'}</span><b>${quantity(marker.quantity)} ${h(asset.symbol)}</b></div><div><span>Trade price</span><b>${money(marker.priceCents, marker.priceCents < 100 ? 4 : 2)}</b></div><div><span>${marker.side === 'buy' ? 'Profit / loss' : 'Move since sale'}</span><b class="${performance.cents >= 0 ? 'positive' : 'negative'}">${performance.cents >= 0 ? '+' : '-'}${money(Math.abs(performance.cents))} · ${pct(performance.percent)}</b></div></div>` : ''}
  </section>`;
}

function chartModel(rawPoints) {
  const points = rawPoints.map((point) => ({ time: Number(point.time), price: Number(point.price) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price))
    .sort((a, b) => a.time - b.time);
  const values = points.map((point) => point.price);
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const minTime = points[0].time; const maxTime = points.at(-1).time || minTime + 1;
  const x = (time) => 18 + ((Number(time) - minTime) / Math.max(1, maxTime - minTime)) * 724;
  const y = (price) => 184 - ((Number(price) - min) / range) * 154;
  return { points, minTime, maxTime, x, y };
}

function pointOnChartLine(model, time) {
  if (time <= model.points[0].time) return model.points[0];
  if (time >= model.points.at(-1).time) return model.points.at(-1);
  const afterIndex = model.points.findIndex((point) => point.time >= time);
  const before = model.points[Math.max(0, afterIndex - 1)]; const after = model.points[afterIndex];
  const progress = (time - before.time) / Math.max(1, after.time - before.time);
  return { time, price: before.price + (after.price - before.price) * progress };
}

function chartSvg(points, color, marker = null) {
  const model = chartModel(points);
  const line = model.points.map((point, index) => `${index ? 'L' : 'M'}${model.x(point.time).toFixed(1)},${model.y(point.price).toFixed(1)}`).join(' ');
  const area = `${line} L742,198 L18,198 Z`;
  let markerSvg = '';
  if (marker?.createdAt) {
    const tradeTime = new Date(marker.createdAt).getTime();
    if (tradeTime >= model.minTime && tradeTime <= model.maxTime) {
      const tradePoint = pointOnChartLine(model, tradeTime);
      markerSvg = `<circle cx="${model.x(tradePoint.time).toFixed(1)}" cy="${model.y(tradePoint.price).toFixed(1)}" r="6" class="trade-marker-dot"/>`;
    }
  }
  return `<svg viewBox="0 0 760 210" role="img" aria-label="Market price history"><path d="${area}" fill="${h(color)}" opacity=".08"/><path d="${line}" fill="none" stroke="${h(color)}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${markerSvg}<circle class="chart-hover-dot" cx="0" cy="0" r="5"/></svg><div class="chart-tooltip hidden" role="status"></div>`;
}

function bindChartInteraction(element, points) {
  const model = chartModel(points); const svg = $('svg', element); const dot = $('.chart-hover-dot', element); const tooltip = $('.chart-tooltip', element);
  if (!svg || !dot || !tooltip) return;
  const update = (event) => {
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return;
    const pointer = svg.createSVGPoint();
    pointer.x = event.clientX; pointer.y = event.clientY;
    const localPointer = pointer.matrixTransform(screenMatrix.inverse());
    const viewX = Math.max(18, Math.min(742, localPointer.x));
    const targetTime = model.minTime + ((viewX - 18) / 724) * (model.maxTime - model.minTime);
    const selected = pointOnChartLine(model, targetTime);
    const pointX = model.x(selected.time); const pointY = model.y(selected.price);
    dot.setAttribute('cx', pointX.toFixed(1)); dot.setAttribute('cy', pointY.toFixed(1)); dot.classList.add('visible');
    const cents = selected.price * 100; const digits = cents < 100 ? 4 : cents < 10000 ? 2 : 0;
    tooltip.innerHTML = `<b>${money(cents, digits)}</b><span>${new Date(selected.time).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}</span>`;
    const chartPoint = svg.createSVGPoint(); chartPoint.x = pointX; chartPoint.y = pointY;
    const screenPoint = chartPoint.matrixTransform(screenMatrix);
    const elementBounds = element.getBoundingClientRect();
    tooltip.style.setProperty('--tooltip-x', `${screenPoint.x - elementBounds.left}px`);
    tooltip.style.setProperty('--tooltip-y', `${screenPoint.y - elementBounds.top}px`);
    tooltip.classList.remove('hidden');
  };
  const clear = () => { dot.classList.remove('visible'); tooltip.classList.add('hidden'); };
  svg.addEventListener('pointermove', update); svg.addEventListener('pointerleave', clear);
}

async function hydrateMarketCharts(root = document) {
  const charts = $$('[data-market-chart]:not([data-chart-ready])', root);
  await Promise.all(charts.map(async (element) => {
    element.dataset.chartReady = 'loading';
    const providerId = element.dataset.provider;
    const marker = element.dataset.markerTime ? { createdAt: element.dataset.markerTime, side: element.closest('[data-trade-side]')?.dataset.tradeSide || 'buy' } : null;
    const key = providerId;
    try {
      if (!providerId) throw new Error('Market provider unavailable');
      if (!state.chartCache.has(key)) state.chartCache.set(key, api(`/api/market/${encodeURIComponent(providerId)}/history`));
      const payload = await state.chartCache.get(key);
      if (payload.providerId !== providerId) throw new Error('Market history mismatch');
      if (payload.rangeDays !== 7) throw new Error('Unexpected market history range');
      if (!payload.points.length) throw new Error('Chart unavailable');
      element.innerHTML = chartSvg(payload.points, Number(element.dataset.change) >= 0 ? '#78e7bc' : '#ff6577', marker);
      bindChartInteraction(element, payload.points);
      element.dataset.chartReady = 'true';
    } catch {
      state.chartCache.delete(key);
      element.innerHTML = '<span class="chart-unavailable">Price history unavailable</span>';
      element.dataset.chartReady = 'error';
    }
  }));
}

function feedCard(item) {
  const market = graphAsset({ ...item, id: item.assetId, name: item.assetName, color: item.assetColor, priceCents: item.currentPriceCents });
  return `<article class="feed-card" data-feed-id="${item.id}" data-trade-side="${item.side}">
    <div class="feed-top">
      <button class="person text-button" data-profile="${h(item.username)}">${avatar(item, 'small')}<span><b>@${h(item.username)}</b><small>${ago(item.createdAt)}</small></span></button>
      <span class="eyebrow-small">${item.sourceTradeId ? 'Copied trade' : 'Trade'}</span>
    </div>
    ${marketEmbed(market, item)}
    <div class="feed-actions">
      <button data-like="${item.id}" class="${item.liked ? 'active' : ''}" aria-label="Like trade">${actionIcon('like')}<span>${item.likes}</span></button>
      <button data-comments="${item.id}" aria-expanded="false" aria-label="Show comments">${actionIcon('comment')}<span>${item.comments}</span></button>
      <button class="copy-button" data-copy="${item.id}" data-asset-id="${item.assetId}" data-side="${item.side}">Copy trade</button>
    </div>
    <div class="inline-comments hidden" data-comment-panel="trade-${item.id}"></div>
  </article>`;
}

function marketRow(asset, watched = false) {
  const positive = Number(asset.change24h) >= 0;
  return `<div class="market-row" data-asset="${asset.id}">
    <div class="asset-name">${coin(asset)}<span><b>${h(asset.name)}</b><small>${h(asset.symbol)}</small></span></div>
    <div class="price-cell"><b>${assetPrice(asset)}</b><small class="${positive ? 'positive' : 'negative'}">${pct(asset.change24h)}</small></div>
    <button class="star-button ${watched ? 'active' : ''}" data-watch="${asset.id}" aria-label="Toggle ${h(asset.name)} watchlist">${watched ? '★' : '☆'}</button>
  </div>`;
}

function pageHead(title, subtitle, action = '') {
  return `<header class="page-head"><div><h1>${h(title)}</h1><p>${h(subtitle)}</p></div>${action}</header>`;
}

async function loadDashboard(showLoader = true) {
  if (showLoader) $('#view').innerHTML = '<div class="page-loader"><span></span><p>Opening the market…</p></div>';
  state.dashboard = await api('/api/dashboard');
  state.user = state.dashboard.user;
  $('#side-name').textContent = `@${state.user.username}`;
  $('#side-username').textContent = 'View profile';
  $('#side-avatar').textContent = initials(state.user.username);
  $('#side-avatar').style.setProperty('--avatar', state.user.avatarColor);
}

function allocationGradient(portfolio, holdings) {
  const entries = holdings.map((item, index) => ({ value: item.valueCents, color: allocationColors[index] }));
  entries.push({ value: portfolio.cashCents, color: '#41494e' });
  let start = 0;
  const stops = entries.map((entry) => {
    const end = start + entry.value / Math.max(1, portfolio.totalCents) * 100;
    const stop = `${entry.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function renderHome() {
  const { portfolio, assets, feed, leaderboard: leaders, watchlist } = state.dashboard;
  const returnClass = portfolio.returnCents >= 0 ? 'positive' : 'negative';
  const watchedAssets = assets.filter((asset) => watchlist.includes(asset.id)).slice(0, 4);
  const holdings = portfolio.holdings.slice(0, 4);
  const allocationHoldings = portfolio.holdings;
  $('#view').innerHTML = `${pageHead(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, @${state.user.username}`, 'Here is what is moving today.', '<button class="outline-button" data-route="transfer">Transfer funds</button>')}
    <section class="grid-home">
      <div class="card balance-card">
        <span class="balance-label">Total portfolio value</span>
        <div class="balance-value">${money(portfolio.totalCents)}</div>
        <div class="balance-breakdown"><div><span>Available EUR</span><b>${money(portfolio.cashCents)}</b></div><div><span>Cryptocurrency</span><b>${money(portfolio.investedCents)}</b></div><div><span>Total return</span><b class="${returnClass}">${portfolio.returnCents >= 0 ? '+' : '-'}${money(Math.abs(portfolio.returnCents))}</b></div></div>
      </div>
      <div class="card quick-card"><div class="card-head"><h2>Portfolio split</h2><button class="text-button" data-route="portfolio">View portfolio</button></div>
        <div class="allocation"><div class="donut" style="background:${allocationGradient(portfolio, allocationHoldings)}"></div><div class="allocation-stats">
          ${allocationHoldings.length ? allocationHoldings.map((item, i) => `<div><span><i class="dot" style="background:${allocationColors[i]}"></i>${h(item.symbol)}</span><b>${Math.round(item.valueCents / Math.max(1, portfolio.totalCents) * 100)}%</b></div>`).join('') : '<div><span>No holdings yet</span><b>€0</b></div>'}
          <div><span><i class="dot" style="background:#41494e"></i>Cash</span><b>${Math.round(portfolio.cashCents / Math.max(1, portfolio.totalCents) * 100)}%</b></div>
        </div></div>
      </div>
    </section>
    <section class="section-grid">
      <div class="card"><div class="card-head"><h2>Watchlist</h2><button class="text-button" data-route="markets">All markets</button></div><div class="market-list">${watchedAssets.length ? watchedAssets.map((asset) => marketRow(asset, true)).join('') : '<div class="empty">Add markets to your watchlist.</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Recent trades</h2><button class="text-button" data-route="recent">View all</button></div><div class="feed-list">${feed.slice(0, 3).map(feedCard).join('')}</div></div>
    </section>
    <section class="section-grid">
      <div class="card"><div class="card-head"><h2>Your positions</h2><button class="text-button" data-route="portfolio">View all</button></div><div class="holding-list">${holdings.length ? holdings.map((item) => marketRow({ ...item, id: item.assetId }, watchlist.includes(item.assetId))).join('') : '<div class="empty">Your first position will appear here.</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Top traders</h2><button class="text-button" data-route="discover">Leaderboard</button></div>${leaders.slice(0, 4).map((person, i) => `<div class="market-row" style="grid-template-columns:24px 1fr auto"><b class="rank ${i < 3 ? 'top' : ''}">${i + 1}</b><button class="person text-button" data-profile="${h(person.username)}">${avatar(person, 'small')}<span><b>@${h(person.username)}</b><small>${money(person.totalCents)}</small></span></button><b class="${person.returnPercent >= 0 ? 'positive' : 'negative'}">${pct(person.returnPercent)}</b></div>`).join('')}</div>
    </section>`;
  hydrateMarketCharts($('#view'));
}

function renderMarkets() {
  let assets = state.dashboard.assets;
  const watched = state.dashboard.watchlist;
  if (state.marketFilter === 'watchlist') assets = assets.filter((asset) => watched.includes(asset.id));
  else if (state.marketFilter !== 'all') assets = assets.filter((asset) => asset.category === state.marketFilter);
  if (state.search) assets = assets.filter((asset) => `${asset.name} ${asset.symbol}`.toLowerCase().includes(state.search.toLowerCase()));
  $('#view').innerHTML = `${pageHead('Markets', 'Live crypto, precious metals and memory prices.', `<div class="segmented market-filters" id="market-filter"><button class="${state.marketFilter === 'all' ? 'active' : ''}" data-market-filter="all">All</button><button class="${state.marketFilter === 'crypto' ? 'active' : ''}" data-market-filter="crypto">Crypto</button><button class="${state.marketFilter === 'commodity' ? 'active' : ''}" data-market-filter="commodity">Metals</button><button class="${state.marketFilter === 'memory' ? 'active' : ''}" data-market-filter="memory">Memory</button><button class="${state.marketFilter === 'watchlist' ? 'active' : ''}" data-market-filter="watchlist">Watchlist</button></div>`)}
    <div class="market-grid">${assets.length ? assets.map((asset) => {
      const positive = asset.change24h >= 0;
      return `<article class="card asset-card" data-asset="${asset.id}"><div class="asset-card-top"><div class="asset-name">${coin(asset)}<span><b>${h(asset.name)}</b><small>${h(asset.symbol)}</small></span></div><button class="star-button ${watched.includes(asset.id) ? 'active' : ''}" data-watch="${asset.id}">${watched.includes(asset.id) ? '★' : '☆'}</button></div><div class="asset-price">${assetPrice(asset)}</div><span class="${positive ? 'positive' : 'negative'}">${pct(asset.change24h)} today</span></article>`;
    }).join('') : '<div class="empty card market-empty">No markets match this view.</div>'}</div>`;
}

function renderPortfolio() {
  const p = state.dashboard.portfolio;
  $('#view').innerHTML = `${pageHead('Portfolio', 'Your holdings and performance.', '<button class="primary-button compact" data-open-trade>Buy crypto</button>')}
    <div class="portfolio-summary"><div class="card metric-card"><small>Total value</small><strong>${money(p.totalCents)}</strong></div><div class="card metric-card"><small>Invested</small><strong>${money(p.investedCents)}</strong></div><div class="card metric-card"><small>Available EUR</small><strong>${money(p.cashCents)}</strong></div><div class="card metric-card"><small>Total return</small><strong class="${p.returnCents >= 0 ? 'positive' : 'negative'}">${p.returnCents >= 0 ? '+' : '-'}${money(Math.abs(p.returnCents))}</strong></div></div>
    <div class="card"><div class="card-head"><h2>Holdings</h2><span class="eyebrow-small">${p.holdings.length} assets</span></div>
      <div class="holding-row header"><span>Asset</span><span>Quantity</span><span>Avg. price</span><span>Return</span><span>Value</span><span>Trade</span></div>
      ${p.holdings.length ? p.holdings.map((item) => `<div class="holding-row"><div class="asset-name" data-asset="${item.assetId}">${coin(item)}<span><b>${h(item.name)}</b><small>${h(item.symbol)}</small></span></div><span>${quantity(item.quantity)}</span><span>${money(item.averageCostCents, item.averageCostCents < 100 ? 4 : 2)}</span><span class="${item.returnCents >= 0 ? 'positive' : 'negative'}">${pct(item.returnPercent)}</span><b>${money(item.valueCents)}</b><span class="trade-row-actions"><button class="outline-button" data-trade-asset="${item.assetId}" data-trade-side="buy">Buy</button><button class="outline-button sell-action" data-trade-asset="${item.assetId}" data-trade-side="sell">Sell</button></span></div>`).join('') : '<div class="empty">No positions yet. Make your first trade.</div>'}
    </div>`;
}

async function renderRecentTrades(reset = true) {
  if (reset) {
    state.feedItems = state.dashboard.feed;
    state.feedCursor = state.feedItems.at(-1)?.id || null;
    $('#view').innerHTML = `${pageHead('Recent trades', 'Live buying and selling activity across the platform.')}<div class="card feed-list" id="full-feed"></div><div class="infinite-sentinel" id="feed-sentinel">Scroll for more trades</div>`;
  }
  $('#full-feed').innerHTML = state.feedItems.length ? state.feedItems.map(feedCard).join('') : '<div class="empty">No activity to show yet.</div>';
  hydrateMarketCharts($('#full-feed'));
  setupInfinite('#feed-sentinel', async () => {
    if (!state.feedCursor) return false;
    const payload = await api(`/api/feed?cursor=${state.feedCursor}`);
    if (!payload.items.length) { state.feedCursor = null; return false; }
    state.feedItems.push(...payload.items); state.feedCursor = payload.items.at(-1).id; renderRecentTrades(false); return true;
  });
}

function postCard(post) {
  const referenced = post.referencedAssetId ? marketEmbed({
    id: post.referencedAssetId, symbol: post.referencedSymbol, name: post.referencedAssetName,
    color: post.referencedAssetColor, iconUrl: post.referencedIconUrl, providerId: post.referencedProviderId,
    priceCents: post.referencedPriceCents, change24h: post.referencedChange24h, category: post.referencedCategory,
  }) : '';
  const trade = post.tradeId ? {
    id: post.tradeAssetId, assetId: post.tradeAssetId, symbol: post.tradeSymbol, name: post.tradeAssetName,
    assetName: post.tradeAssetName, color: post.tradeAssetColor, assetColor: post.tradeAssetColor,
    iconUrl: post.tradeIconUrl, providerId: post.tradeProviderId, priceCents: post.tradePriceCents,
    currentPriceCents: post.tradeCurrentPriceCents, change24h: post.tradeChange24h, category: post.tradeCategory,
    side: post.tradeSide, quantity: post.tradeQuantity, totalCents: post.tradeTotalCents, createdAt: post.tradeCreatedAt,
  } : null;
  return `<article class="community-post"${trade ? ` data-trade-side="${trade.side}"` : ''}><header class="feed-top"><button class="person text-button" data-profile="${h(post.username)}">${avatar(post, 'small')}<span><b>@${h(post.username)}</b><small>${ago(post.createdAt)}</small></span></button><span class="eyebrow-small">${trade ? 'Trade update' : post.referencedAssetId ? 'Market discussion' : 'Post'}</span></header>${trade ? marketEmbed(trade, trade) : referenced}<p class="post-body">${h(post.body)}</p><div class="feed-actions"><button data-post-like="${post.id}" class="${post.liked ? 'active' : ''}" aria-label="Like post">${actionIcon('like')}<span>${post.likes}</span></button><button data-post-comments="${post.id}" aria-expanded="false" aria-label="Show comments">${actionIcon('comment')}<span>${post.comments}</span></button></div><div class="inline-comments hidden" data-comment-panel="post-${post.id}"></div></article>`;
}

async function renderCommunity(reset = true) {
  if (reset) {
    const payload = await api('/api/community?offset=0');
    state.communityItems = payload.items; state.communityOffset = payload.items.length;
    $('#view').innerHTML = `${pageHead('Community', 'Ideas, commentary and trades from people across the market.', '<div class="segmented" id="community-filter"><button class="active" data-community-following="0">For you</button><button data-community-following="1">Following</button></div>')}
      <form class="card post-composer" id="post-form"><div id="composer-market-preview"></div><div class="composer-main">${avatar(state.user, 'small')}<textarea name="body" maxlength="1000" placeholder="What is your market view?" required></textarea></div><div class="composer-tools"><select name="assetId" id="composer-asset"><option value="">Post without a market</option>${state.dashboard.assets.map((asset) => `<option value="${asset.id}">${h(asset.name)} (${h(asset.symbol)})</option>`).join('')}</select><button class="primary-button compact" type="submit">Post</button></div><p class="form-error" id="post-error"></p></form>
      <div class="card community-list" id="community-list"></div><div class="infinite-sentinel" id="community-sentinel">Scroll for more posts</div>`;
    $('#post-form').addEventListener('submit', async (event) => {
      event.preventDefault(); const button = $('button[type=submit]', event.currentTarget); setBusy(button, true, 'Posting…');
      try { await api('/api/community', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); await renderCommunity(true); toast('Post published'); }
      catch (error) { $('#post-error').textContent = error.message; setBusy(button, false); }
    });
    $('#composer-asset').addEventListener('change', (event) => {
      const selected = state.dashboard.assets.find((asset) => asset.id === Number(event.target.value));
      $('#composer-market-preview').innerHTML = selected ? marketEmbed(selected) : '';
      if (selected) hydrateMarketCharts($('#composer-market-preview'));
    });
  }
  $('#community-list').innerHTML = state.communityItems.length ? state.communityItems.map(postCard).join('') : '<div class="empty">No posts yet. Start the conversation.</div>';
  hydrateMarketCharts($('#community-list'));
  setupInfinite('#community-sentinel', async () => {
    const following = $('#community-filter .active')?.dataset.communityFollowing || '0';
    const payload = await api(`/api/community?offset=${state.communityOffset}&following=${following}`);
    if (!payload.items.length) return false;
    state.communityItems.push(...payload.items); state.communityOffset += payload.items.length; renderCommunity(false); return true;
  });
}

function drawLeaderboard() {
  const { key, direction } = state.leaderboardSort;
  const multiplier = direction === 'asc' ? 1 : -1;
  const users = [...state.leaderboard].sort((a, b) => {
    if (key === 'username') return a.username.localeCompare(b.username) * multiplier;
    return ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * multiplier;
  });
  const arrow = (column) => key === column ? (direction === 'asc' ? ' ↑' : ' ↓') : '';
  $('#leaderboard-table').innerHTML = `<div class="leader-row eyebrow-small"><span>#</span><button data-sort="username">Trader${arrow('username')}</button><button data-sort="totalCents">Portfolio${arrow('totalCents')}</button><button data-sort="returnPercent">Return${arrow('returnPercent')}</button><button data-sort="followers">Followers${arrow('followers')}</button><span></span></div>${users.map((person, i) => `<div class="leader-row"><span class="rank ${i < 3 ? 'top' : ''}">${i + 1}</span><button class="person text-button" data-profile="${h(person.username)}">${avatar(person, 'small')}<span><b>@${h(person.username)}</b></span></button><b>${money(person.totalCents)}</b><b class="${person.returnPercent >= 0 ? 'positive' : 'negative'}">${pct(person.returnPercent)}</b><span>${person.followers.toLocaleString()}</span>${person.id === state.user.id ? '<span class="eyebrow-small">You</span>' : `<button class="outline-button ${person.isFollowing ? 'active' : ''}" data-follow="${person.id}">${person.isFollowing ? 'Following' : 'Follow'}</button>`}</div>`).join('')}`;
}

async function renderDiscover() {
  const payload = await api('/api/leaderboard'); state.leaderboard = payload.users;
  state.leaderboardSort = { key: 'totalCents', direction: 'desc' };
  $('#view').innerHTML = `${pageHead('Leaderboard', 'Find traders by portfolio, performance and following.')}<div class="card" id="leaderboard-table"></div>`;
  drawLeaderboard();
}

function historyRow(item) {
  const isCash = !item.symbol;
  const isIn = ['buy', 'received'].includes(item.type);
  const label = { buy: `Bought ${item.symbol}`, sell: `Sold ${item.symbol}`, sent: `Sent ${item.symbol || 'EUR'}`, received: `Received ${item.symbol || 'EUR'}` }[item.type];
  const amount = isCash ? money(item.amount) : `${quantity(item.amount)} ${item.symbol}`;
  return `<div class="history-row"><span class="event-icon ${isIn ? 'positive' : 'negative'}">${isIn ? '↓' : '↑'}</span><span><b>${h(label)}</b><small>${item.counterpartyWallet ? `${item.type === 'sent' ? 'To' : 'From'} ${h(shortWallet(item.counterpartyWallet))} · ` : ''}${ago(item.createdAt)}</small></span><b>${item.totalCents ? money(item.totalCents) : amount}</b><span class="time">${new Date(item.createdAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>`;
}

async function renderHistory(reset = true) {
  if (reset) {
    const payload = await api('/api/history'); state.historyItems = payload.items;
    state.historyOffset = payload.items.length;
    state.historyFilter = 'all';
    $('#view').innerHTML = `${pageHead('History', 'Every buy, sell, copy and transfer in one place.', '<div class="segmented" id="history-filter"><button class="active" data-history-filter="all">All</button><button data-history-filter="trades">Trades</button><button data-history-filter="transfers">Transfers</button></div>')}<div class="card" id="history-list"></div><div class="infinite-sentinel" id="history-sentinel">Scroll for older activity</div>`;
  }
  const visibleItems = state.historyItems.filter((item) => state.historyFilter === 'all' || (state.historyFilter === 'trades' ? ['buy', 'sell'].includes(item.type) : ['sent', 'received'].includes(item.type)));
  $('#history-list').innerHTML = visibleItems.length ? visibleItems.map(historyRow).join('') : '<div class="empty">No activity in this view.</div>';
  setupInfinite('#history-sentinel', async () => {
    const payload = await api(`/api/history?offset=${state.historyOffset}`);
    if (!payload.items.length) return false;
    state.historyItems.push(...payload.items); state.historyOffset += payload.items.length; renderHistory(false); return true;
  });
}

async function renderTransfer() {
  const p = state.dashboard.portfolio;
  const cryptoHoldings = p.holdings.filter((item) => item.category === 'crypto');
  $('#view').innerHTML = `${pageHead('Wallet transfer', 'Send cryptocurrency to another Trading 1337 wallet.')}
    <section class="wallet-address-card card"><div><span class="eyebrow-small">Your wallet ID</span><strong>${h(state.user.walletAddress)}</strong></div><button class="outline-button" data-copy-wallet="${h(state.user.walletAddress)}">Copy wallet ID</button></section>
    <div class="transfer-layout"><form class="card card-pad modal-form" id="transfer-form">
      <div><label>Contacts</label><div class="contact-picker" id="transfer-contacts"><span class="time">Loading contacts…</span></div><div class="contact-requests" id="contact-requests"></div></div>
      <div><label for="transfer-wallet">Recipient wallet ID</label><input id="transfer-wallet" name="walletAddress" placeholder="0x0000000000000000000000000000000000000000" pattern="0x[a-fA-F0-9]{40}" autocomplete="off" required><div class="wallet-recipient" id="wallet-recipient"></div></div>
      <div><label for="transfer-asset">Cryptocurrency</label><select id="transfer-asset" name="assetId" required><option value="">Choose a holding</option>${cryptoHoldings.map((item) => `<option value="${item.assetId}">${h(item.name)} (${h(item.symbol)})</option>`).join('')}</select><div class="balance-hint"><span>Available balance</span><button class="balance-max" id="transfer-available" type="button" disabled>Choose an asset</button></div></div>
      <div><label for="transfer-amount">Amount</label><input id="transfer-amount" name="amount" type="number" min="0.00000001" step="any" placeholder="0.00" required></div>
      <button class="primary-button wide" type="submit" ${cryptoHoldings.length ? '' : 'disabled'}>Review transfer <span>→</span></button><p class="form-error" id="transfer-error">${cryptoHoldings.length ? '' : 'You need a cryptocurrency holding before you can make a transfer.'}</p>
    </form><aside class="card info-panel"><span class="eyebrow-small">Wallet transfer</span><h2>Send directly to another wallet</h2><ol><li>Choose a contact or enter their wallet ID.</li><li>Select one of your cryptocurrency holdings.</li><li>Review the final wallet and amount before sending.</li></ol><p class="time">Euro balances cannot be transferred between users.</p></aside></div>`;
  $('#transfer-asset').addEventListener('change', (event) => {
    const holding = cryptoHoldings.find((item) => item.assetId === Number(event.target.value));
    $('#transfer-available').textContent = holding ? `${quantity(holding.quantity)} ${holding.symbol} · Use all` : 'Choose an asset';
    $('#transfer-available').disabled = !holding;
  });
  $('#transfer-available').addEventListener('click', () => {
    const holding = cryptoHoldings.find((item) => item.assetId === Number($('#transfer-asset').value));
    if (holding) $('#transfer-amount').value = String(holding.quantity);
  });
  let recipientTimer;
  $('#transfer-wallet').addEventListener('input', (event) => {
    clearTimeout(recipientTimer); const address = event.target.value.trim(); $('#wallet-recipient').textContent = '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;
    recipientTimer = setTimeout(async () => {
      try { const payload = await api(`/api/wallets/${address}`); $('#wallet-recipient').innerHTML = `Recipient: <b>@${h(payload.user.username)}</b>`; }
      catch { $('#wallet-recipient').textContent = 'Wallet not found'; }
    }, 250);
  });
  $('#transfer-form').addEventListener('submit', submitTransfer);
  try {
    const payload = await api('/api/contacts');
    $('#transfer-contacts').innerHTML = payload.contacts.length ? payload.contacts.map((contact) => `<button type="button" class="contact-chip" data-contact-wallet="${h(contact.walletAddress)}">${avatar(contact, 'small')}<span><b>@${h(contact.username)}</b><small>${h(shortWallet(contact.walletAddress))}</small></span></button>`).join('') : '<span class="time">Accepted contacts appear here for one-click selection.</span>';
    $('#contact-requests').innerHTML = payload.incoming.length ? `<span class="eyebrow-small">Contact requests</span>${payload.incoming.map((contact) => `<div class="contact-request">${avatar(contact, 'small')}<b>@${h(contact.username)}</b><button type="button" class="outline-button" data-contact-accept="${contact.contactId}">Accept</button></div>`).join('')}` : '';
  } catch (error) { $('#transfer-contacts').innerHTML = `<span class="time">${h(error.message)}</span>`; }
}

function contactButton(profile) {
  if (profile.contactStatus === 'accepted') return '<button class="outline-button active" disabled>Contact</button>';
  if (profile.contactStatus === 'outgoing') return '<button class="outline-button" disabled>Request sent</button>';
  if (profile.contactStatus === 'incoming') return `<button class="outline-button" data-contact-accept="${profile.contactRequestId}">Accept contact</button>`;
  return `<button class="outline-button" data-profile-contact="${profile.id}" data-contact-mode="request">Add contact</button>`;
}

function renderProfile(profile = state.user, portfolio = state.dashboard.portfolio, activity = state.dashboard.feed.filter((item) => item.userId === profile.id)) {
  const own = profile.id === state.user.id;
  $('#view').innerHTML = `${pageHead('Trader profile', own ? 'Your public view.' : `@${profile.username}`)}
    <section class="card profile-header">${avatar(profile, 'large')}<div><h1>@${h(profile.username)}</h1><span class="profile-full-name">${h(profile.displayName)}</span><p>${h(profile.bio || 'Active market participant.')}</p><button class="profile-wallet" data-copy-wallet="${h(profile.walletAddress)}"><span>${h(shortWallet(profile.walletAddress))}</span><small>Copy wallet ID</small></button></div>
      <div class="profile-stats"><span><b>${profile.followers}</b><small>Followers</small></span><span><b>${profile.following}</b><small>Following</small></span><span><b>${profile.trades}</b><small>Trades</small></span></div>
      ${own ? '<button class="outline-button" id="logout-button">Log out</button>' : `<div class="profile-actions"><button class="outline-button ${profile.isFollowing ? 'active' : ''}" data-follow="${profile.id}">${profile.isFollowing ? 'Following' : 'Follow'}</button>${contactButton(profile)}</div>`}
    </section>
    <div class="portfolio-summary" style="margin-top:18px"><div class="card metric-card"><small>Portfolio value</small><strong>${money(portfolio.totalCents)}</strong></div><div class="card metric-card"><small>Invested</small><strong>${money(portfolio.investedCents)}</strong></div><div class="card metric-card"><small>Available EUR</small><strong>${money(portfolio.cashCents)}</strong></div><div class="card metric-card"><small>Return</small><strong class="${portfolio.returnCents >= 0 ? 'positive' : 'negative'}">${portfolio.returnCents >= 0 ? '+' : '-'}${money(Math.abs(portfolio.returnCents))}</strong></div></div>
    <section class="section-grid"><div class="card"><div class="card-head"><h2>Public holdings</h2></div>${portfolio.holdings.length ? portfolio.holdings.map((item) => marketRow({ ...item, id: item.assetId })).join('') : '<div class="empty">No holdings.</div>'}</div><div class="card"><div class="card-head"><h2>Recent activity</h2></div>${activity.length ? activity.map(feedCard).join('') : '<div class="empty">No public activity.</div>'}</div></section>`;
  $('#logout-button')?.addEventListener('click', logout);
  hydrateMarketCharts($('#view'));
}

function setupInfinite(selector, loader) {
  state.infiniteObserver?.disconnect();
  const sentinel = $(selector); if (!sentinel) return;
  let loading = false;
  state.infiniteObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading) return;
    loading = true; sentinel.textContent = 'Loading…';
    try { const more = await loader(); sentinel.textContent = more ? 'Scroll for more' : 'You’re all caught up'; }
    catch { sentinel.textContent = 'Could not load more'; }
    loading = false;
  }, { rootMargin: '240px' });
  state.infiniteObserver.observe(sentinel);
}

async function navigate(route) {
  state.route = route; state.infiniteObserver?.disconnect();
  $$('.nav-item, .nav-subitem, .mobile-nav button').forEach((item) => item.classList.toggle('active', item.dataset.route === route));
  if (['discover', 'recent', 'community'].includes(route)) {
    $('[data-nav-toggle="discover"]').classList.add('active');
    $('[data-nav-toggle="discover"]').setAttribute('aria-expanded', 'true');
    $('#discover-submenu').classList.remove('hidden');
  }
  closeNavigation();
  $('#view').innerHTML = '<div class="page-loader"><span></span><p>Loading…</p></div>';
  try {
    if (['home', 'markets', 'portfolio', 'profile', 'transfer'].includes(route)) await loadDashboard(false);
    if (route === 'home') renderHome();
    else if (route === 'markets') renderMarkets();
    else if (route === 'portfolio') renderPortfolio();
    else if (route === 'community') { await loadDashboard(false); await renderCommunity(); }
    else if (route === 'recent') await renderRecentTrades();
    else if (route === 'discover') await renderDiscover();
    else if (route === 'history') await renderHistory();
    else if (route === 'transfer') await renderTransfer();
    else if (route === 'profile') renderProfile();
  } catch (error) { $('#view').innerHTML = `<div class="empty"><h2>Could not load this page</h2><p>${h(error.message)}</p></div>`; }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openModal(content, wide = false) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}">${content}</section></div>`;
  $('.modal-backdrop').addEventListener('click', (event) => { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
  $('.close-modal')?.addEventListener('click', closeModal);
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function closeNavigation() {
  $('.sidebar')?.classList.remove('open');
  $('#sidebar-scrim')?.classList.remove('open');
  $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
}

function openTrade(assetId = null, sourceTradeId = null, initialSide = 'buy') {
  const assets = state.dashboard.assets;
  const selected = assets.find((asset) => asset.id === Number(assetId)) || assets[0];
  if (!selected) { toast('No tradable assets are available.', 'error'); return; }
  let side = initialSide === 'sell' ? 'sell' : 'buy';
  openModal(`<div class="modal-head"><h2>${sourceTradeId ? 'Copy trade' : 'Place an order'}</h2><button class="close-modal">×</button></div><div class="modal-body">
    <form class="modal-form" id="trade-form"><div id="trade-entry"><div><label>Asset</label><select id="trade-asset" name="assetId">${assets.map((asset) => `<option value="${asset.id}" ${asset.id === selected.id ? 'selected' : ''}>${h(asset.name)} (${h(asset.symbol)})</option>`).join('')}</select></div>
      <div class="order-asset" id="order-asset">${coin(selected)}<span><b>${h(selected.name)}</b><small>${h(selected.symbol)}</small></span><span class="order-quote"><b>${assetPrice(selected)}</b><small class="${selected.change24h >= 0 ? 'positive' : 'negative'}">${pct(selected.change24h)}</small></span></div>
      <div class="order-type"><button type="button" class="${side === 'buy' ? 'active' : ''}" data-side="buy">Buy</button><button type="button" class="sell ${side === 'sell' ? 'active' : ''}" data-side="sell">Sell</button></div>
      <input type="hidden" name="side" value="${side}"><input type="hidden" name="sourceTradeId" value="${sourceTradeId || ''}">
      <div><label id="trade-amount-label">${side === 'buy' ? 'Amount to spend' : `Amount of ${h(selected.symbol)} to sell`}</label><div class="amount-input"><span id="amount-unit">${side === 'buy' ? '€' : h(selected.symbol)}</span><input id="trade-amount" name="amount" type="number" min="0" step="any" placeholder="0" required autofocus></div><div class="balance-hint"><span id="balance-label">${side === 'buy' ? 'Available EUR balance' : `Available ${h(selected.symbol)} balance`}</span><button class="balance-max" id="order-balance" type="button"></button></div></div>
      <div class="order-preview"><div><span>Estimated quantity</span><b id="estimated-quantity">— ${h(selected.symbol)}</b></div><div><span>Execution</span><b>Instant market order</b></div></div></div>
      <div id="trade-review" class="hidden"><span class="eyebrow-small">Review order</span><h3 id="review-title"></h3><div class="order-preview" id="review-details"></div><button class="text-button review-back" id="review-back" type="button">← Edit order</button></div>
      <button class="primary-button wide" id="trade-submit" type="submit">Review ${sourceTradeId ? 'copy' : 'order'} <span>→</span></button><p class="form-error" id="trade-error"></p>
    </form></div>`);
  let reviewing = false;
  const updateOrder = () => {
    const asset = assets.find((item) => item.id === Number($('#trade-asset').value));
    const amount = Number($('#trade-amount').value || 0);
    const own = state.dashboard.portfolio.holdings.find((item) => item.assetId === asset.id);
    $('#order-asset').innerHTML = `${coin(asset)}<span><b>${h(asset.name)}</b><small>${h(asset.symbol)}</small></span><span class="order-quote"><b>${assetPrice(asset)}</b><small class="${asset.change24h >= 0 ? 'positive' : 'negative'}">${pct(asset.change24h)}</small></span>`;
    $('#trade-amount-label').textContent = side === 'buy' ? 'Amount to spend' : `Amount of ${asset.symbol} to sell`;
    $('#amount-unit').textContent = side === 'buy' ? '€' : asset.symbol;
    $('#balance-label').textContent = side === 'buy' ? 'Available EUR balance' : `Available ${asset.symbol} balance`;
    $('#estimated-quantity').textContent = side === 'buy' ? `${quantity(amount * 100 / asset.priceCents)} ${asset.symbol}` : money(amount * asset.priceCents);
    $('#order-balance').textContent = side === 'buy' ? `${money(state.dashboard.portfolio.cashCents)} · Use all` : `${quantity(own?.quantity || 0)} ${asset.symbol} · Sell all`;
  };
  $$('.order-type button').forEach((button) => button.addEventListener('click', () => {
    $$('.order-type button').forEach((x) => x.classList.remove('active')); button.classList.add('active');
    side = button.dataset.side; $('#trade-form [name=side]').value = side; $('#trade-amount').value = ''; updateOrder();
  }));
  $('#trade-asset').addEventListener('change', () => { $('#trade-amount').value = ''; updateOrder(); });
  $('#trade-amount').addEventListener('input', updateOrder);
  $('#order-balance').addEventListener('click', () => {
    const asset = assets.find((item) => item.id === Number($('#trade-asset').value));
    const own = state.dashboard.portfolio.holdings.find((item) => item.assetId === asset.id);
    $('#trade-amount').value = side === 'buy' ? (state.dashboard.portfolio.cashCents / 100).toFixed(2) : String(own?.quantity || 0);
    updateOrder();
  });
  $('#review-back').addEventListener('click', () => {
    reviewing = false; $('#trade-entry').classList.remove('hidden'); $('#trade-review').classList.add('hidden');
    $('#trade-submit').innerHTML = `Review ${sourceTradeId ? 'copy' : 'order'} <span>→</span>`;
  });
  $('#trade-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('#trade-submit');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const asset = assets.find((item) => item.id === Number(data.assetId));
    const own = state.dashboard.portfolio.holdings.find((item) => item.assetId === asset.id);
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) { $('#trade-error').textContent = 'Enter an amount greater than zero.'; return; }
    if (side === 'buy' && Math.round(amount * 100) > state.dashboard.portfolio.cashCents) { $('#trade-error').textContent = 'Amount exceeds your available EUR balance.'; return; }
    if (side === 'sell' && amount > (own?.quantity || 0)) { $('#trade-error').textContent = `Amount exceeds your available ${asset.symbol} balance.`; return; }
    if (!reviewing) {
      reviewing = true; $('#trade-error').textContent = ''; $('#trade-entry').classList.add('hidden'); $('#trade-review').classList.remove('hidden');
      $('#review-title').textContent = `${side === 'buy' ? 'Buy' : 'Sell'} ${asset.symbol}`;
      const total = side === 'buy' ? amount * 100 : amount * asset.priceCents;
      const units = side === 'buy' ? amount * 100 / asset.priceCents : amount;
      $('#review-details').innerHTML = `<div><span>Asset</span><b>${h(asset.name)} (${h(asset.symbol)})</b></div><div><span>Quantity</span><b>${quantity(units)} ${h(asset.symbol)}</b></div><div><span>Estimated value</span><b>${money(total)}</b></div><div><span>Market price</span><b>${assetPrice(asset)}</b></div>`;
      button.innerHTML = `Confirm ${side === 'buy' ? 'buy' : 'sell'} <span>→</span>`; return;
    }
    setBusy(button, true, 'Executing…');
    try {
      const payload = sourceTradeId
        ? await api(`/api/trades/${sourceTradeId}/copy`, { method: 'POST', body: { amount: data.amount } })
        : await api('/api/trades', { method: 'POST', body: data });
      await loadDashboard(false);
      showTradeSuccess(payload.trade);
    } catch (error) { $('#trade-error').textContent = error.message; setBusy(button, false); }
  });
  updateOrder();
  setTimeout(() => $('#trade-amount')?.focus(), 50);
}

function showTradeSuccess(trade) {
  const asset = graphAsset({ ...trade, id: trade.assetId, name: trade.assetName, color: trade.assetColor });
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="modal-head"><h2>Order complete</h2><button class="close-modal">×</button></div><div class="modal-body trade-success"><span class="success-mark">✓</span><h3>${trade.side === 'buy' ? 'Bought' : 'Sold'} ${h(asset.symbol)}</h3><p>${quantity(trade.quantity)} ${h(asset.symbol)} at ${money(trade.priceCents, trade.priceCents < 100 ? 4 : 2)}</p><div class="success-actions"><button class="primary-button wide" id="post-completed-trade">Post to Community <span>→</span></button><button class="outline-button wide" id="finish-trade">Done</button></div></div></section></div>`;
  $('.close-modal').addEventListener('click', closeModal);
  $('#finish-trade').addEventListener('click', () => {
    closeModal();
    if (['home', 'markets', 'portfolio', 'community', 'recent', 'history', 'transfer', 'profile', 'discover'].includes(state.route)) navigate(state.route);
  });
  $('#post-completed-trade').addEventListener('click', () => { closeModal(); renderTradePostComposer(trade); });
}

function renderTradePostComposer(trade) {
  state.route = 'trade-post';
  const asset = graphAsset({ ...trade, id: trade.assetId, name: trade.assetName, color: trade.assetColor });
  $('#view').innerHTML = `${pageHead('Post your trade', 'Add your view to the completed trade.', '<button class="outline-button" data-route="community">Cancel</button>')}<form class="card trade-post-composer" id="trade-post-form" data-trade-side="${trade.side}">${marketEmbed(asset, trade)}<div class="composer-main">${avatar(state.user, 'small')}<textarea name="body" maxlength="1000" placeholder="What was your reasoning for this trade?" required autofocus></textarea></div><div class="composer-submit"><button class="primary-button" type="submit">Post to Community</button><p class="form-error" id="trade-post-error"></p></div></form>`;
  hydrateMarketCharts($('#trade-post-form'));
  $('#trade-post-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type=submit]', event.currentTarget); setBusy(button, true, 'Posting…');
    const body = new FormData(event.currentTarget).get('body');
    try { await api('/api/community', { method: 'POST', body: { body, tradeId: trade.id } }); toast('Trade posted'); await navigate('community'); }
    catch (error) { $('#trade-post-error').textContent = error.message; setBusy(button, false); }
  });
  setTimeout(() => $('#trade-post-form textarea')?.focus(), 50);
}

async function openAsset(assetId) {
  const asset = state.dashboard.assets.find((item) => item.id === Number(assetId)); if (!asset) return;
  openModal(`<div class="modal-head"><h2>${h(asset.name)} · ${h(asset.symbol)}</h2><button class="close-modal">×</button></div><div class="modal-body">${marketEmbed(asset)}<button class="primary-button wide" id="asset-trade">Trade ${h(asset.symbol)} <span>→</span></button></div>`, true);
  await hydrateMarketCharts($('.modal'));
  $('#asset-trade')?.addEventListener('click', () => openTrade(asset.id));
}

function commentList(comments) {
  return comments.length ? comments.map((comment) => `<div class="comment">${avatar(comment, 'small')}<div><b>@${h(comment.username)}</b><span class="time"> · ${ago(comment.createdAt)}</span><p>${h(comment.body)}</p></div></div>`).join('') : '<div class="comment-empty">Start the conversation.</div>';
}

async function toggleInlineComments(button, kind, id) {
  const card = button.closest('.feed-card, .community-post');
  const panel = $(`[data-comment-panel="${kind}-${id}"]`, card);
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening); button.setAttribute('aria-expanded', String(opening));
  if (!opening || panel.dataset.loaded) return;
  panel.innerHTML = '<div class="comment-loading">Loading comments…</div>';
  const endpoint = kind === 'trade' ? `/api/trades/${id}/comments` : `/api/community/${id}/comments`;
  try {
    const payload = await api(endpoint);
    panel.innerHTML = `<div class="comments">${commentList(payload.comments)}</div><form class="inline-comment-form" data-comment-kind="${kind}" data-comment-id="${id}"><textarea name="body" maxlength="280" rows="2" placeholder="Add a comment…" required></textarea><div><p class="form-error"></p><button class="primary-button compact" type="submit">Comment</button></div></form>`;
    panel.dataset.loaded = 'true';
  } catch (error) { panel.innerHTML = `<p class="form-error">${h(error.message)}</p>`; }
}

async function submitInlineComment(form) {
  const body = new FormData(form).get('body');
  const { commentKind: kind, commentId: id } = form.dataset;
  const endpoint = kind === 'trade' ? `/api/trades/${id}/comments` : `/api/community/${id}/comments`;
  const button = $('button[type=submit]', form); setBusy(button, true, 'Posting…');
  try {
    await api(endpoint, { method: 'POST', body: { body } });
    const payload = await api(endpoint);
    const panel = form.closest('.inline-comments');
    $('.comments', panel).innerHTML = commentList(payload.comments);
    form.reset(); setBusy(button, false); toast('Comment posted');
    const counter = kind === 'trade' ? panel.parentElement.querySelector('[data-comments] span') : panel.parentElement.querySelector('[data-post-comments] span');
    if (counter) counter.textContent = payload.comments.length;
  } catch (error) { $('.form-error', form).textContent = error.message; setBusy(button, false); }
}

async function submitTransfer(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const holding = state.dashboard.portfolio.holdings.find((item) => item.assetId === Number(body.assetId));
  if (!holding || holding.category !== 'crypto') { $('#transfer-error').textContent = 'Choose a cryptocurrency holding.'; return; }
  const assetLabel = holding.symbol;
  const amountLabel = `${quantity(body.amount)} ${holding.symbol}`;
  openModal(`<div class="modal-head"><h2>Review transfer</h2><button class="close-modal">×</button></div><div class="modal-body"><div class="order-preview"><div><span>Recipient wallet</span><b>${h(shortWallet(body.walletAddress))}</b></div><div><span>Asset</span><b>${h(assetLabel)}</b></div><div><span>Amount</span><b>${h(amountLabel)}</b></div></div><button class="primary-button wide" id="confirm-transfer" style="margin-top:18px">Confirm transfer <span>→</span></button><p class="form-error" id="confirm-transfer-error"></p></div>`);
  $('#confirm-transfer').addEventListener('click', async () => {
    const button = $('#confirm-transfer'); setBusy(button, true, 'Sending…');
    try { await api('/api/transfers', { method: 'POST', body }); closeModal(); toast('Transfer completed'); await loadDashboard(false); await renderTransfer(); }
    catch (error) { $('#confirm-transfer-error').textContent = error.message; setBusy(button, false); }
  });
}

async function openProfile(username) {
  $('#view').innerHTML = '<div class="page-loader"><span></span><p>Opening profile…</p></div>';
  try { const payload = await api(`/api/users/${encodeURIComponent(username)}`); state.route = 'external-profile'; renderProfile(payload.user, payload.portfolio, payload.activity); }
  catch (error) { toast(error.message, 'error'); navigate('discover'); }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }); state.user = null; state.dashboard = null;
  $('#app').classList.add('hidden'); $('#auth-screen').classList.remove('hidden');
}

async function submitAuth(event, type) {
  event.preventDefault(); const form = event.currentTarget; const button = $('button[type=submit]', form); setBusy(button, true);
  const body = Object.fromEntries(new FormData(form));
  try { await api(`/api/auth/${type}`, { method: 'POST', body }); await enterApp(); }
  catch (error) { $(`#${type}-error`).textContent = error.message; setBusy(button, false); }
}

async function enterApp() {
  $('#auth-screen').classList.add('hidden'); $('#app').classList.remove('hidden');
  await loadDashboard(); renderHome();
}

document.addEventListener('click', async (event) => {
  const navToggle = event.target.closest('[data-nav-toggle]');
  if (navToggle) {
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    $('#discover-submenu').classList.toggle('hidden', expanded);
    return;
  }
  const route = event.target.closest('[data-route]'); if (route) { event.preventDefault(); navigate(route.dataset.route); return; }
  const copyWallet = event.target.closest('[data-copy-wallet]');
  if (copyWallet) {
    const address = copyWallet.dataset.copyWallet;
    try { await navigator.clipboard.writeText(address); toast('Wallet ID copied'); }
    catch { toast(`Wallet ID: ${address}`); }
    return;
  }
  const trade = event.target.closest('[data-open-trade]'); if (trade) { openTrade(); return; }
  const assetTrade = event.target.closest('[data-trade-asset]'); if (assetTrade) { openTrade(assetTrade.dataset.tradeAsset, null, assetTrade.dataset.tradeSide); return; }
  const asset = event.target.closest('[data-asset]');
  if (asset && !event.target.closest('[data-watch]')) { openAsset(asset.dataset.asset); return; }
  const watch = event.target.closest('[data-watch]');
  if (watch) { event.stopPropagation(); try { await api('/api/watchlist', { method: 'POST', body: { assetId: watch.dataset.watch } }); await loadDashboard(false); state.route === 'markets' ? renderMarkets() : renderHome(); } catch (e) { toast(e.message, 'error'); } return; }
  const like = event.target.closest('[data-like]');
  if (like) { const payload = await api(`/api/trades/${like.dataset.like}/like`, { method: 'POST' }); like.classList.toggle('active', payload.liked); const count = $('span', like); count.textContent = Math.max(0, Number(count.textContent) + (payload.liked ? 1 : -1)); return; }
  const comments = event.target.closest('[data-comments]'); if (comments) { await toggleInlineComments(comments, 'trade', comments.dataset.comments); return; }
  const copy = event.target.closest('[data-copy]'); if (copy) { openTrade(copy.dataset.assetId, copy.dataset.copy, copy.dataset.side); return; }
  const postLike = event.target.closest('[data-post-like]');
  if (postLike) { const payload = await api(`/api/community/${postLike.dataset.postLike}/like`, { method: 'POST' }); postLike.classList.toggle('active', payload.liked); const count = $('span', postLike); count.textContent = Math.max(0, Number(count.textContent) + (payload.liked ? 1 : -1)); return; }
  const postComments = event.target.closest('[data-post-comments]'); if (postComments) { await toggleInlineComments(postComments, 'post', postComments.dataset.postComments); return; }
  const contactWallet = event.target.closest('[data-contact-wallet]');
  if (contactWallet) {
    $('#transfer-wallet').value = contactWallet.dataset.contactWallet;
    $('#transfer-wallet').dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const requestContact = event.target.closest('[data-profile-contact]');
  if (requestContact) {
    try { await api(`/api/users/${requestContact.dataset.profileContact}/contact-request`, { method: 'POST' }); requestContact.textContent = 'Request sent'; requestContact.disabled = true; toast('Contact request sent'); }
    catch (error) { toast(error.message, 'error'); }
    return;
  }
  const acceptContact = event.target.closest('[data-contact-accept]');
  if (acceptContact) {
    try { await api(`/api/contacts/${acceptContact.dataset.contactAccept}/accept`, { method: 'POST' }); toast('Contact added'); if (state.route === 'transfer') await renderTransfer(); else { acceptContact.textContent = 'Contact'; acceptContact.disabled = true; acceptContact.classList.add('active'); } }
    catch (error) { toast(error.message, 'error'); }
    return;
  }
  const sort = event.target.closest('[data-sort]');
  if (sort) { const key = sort.dataset.sort; state.leaderboardSort = { key, direction: state.leaderboardSort.key === key && state.leaderboardSort.direction === 'desc' ? 'asc' : 'desc' }; drawLeaderboard(); return; }
  const communityFilter = event.target.closest('[data-community-following]');
  if (communityFilter) {
    $$('#community-filter button').forEach((button) => button.classList.toggle('active', button === communityFilter));
    const payload = await api(`/api/community?offset=0&following=${communityFilter.dataset.communityFollowing}`);
    state.communityItems = payload.items; state.communityOffset = payload.items.length;
    await renderCommunity(false);
    return;
  }
  const marketFilter = event.target.closest('[data-market-filter]');
  if (marketFilter) { state.marketFilter = marketFilter.dataset.marketFilter; renderMarkets(); return; }
  const historyFilter = event.target.closest('[data-history-filter]');
  if (historyFilter) {
    state.historyFilter = historyFilter.dataset.historyFilter;
    $$('#history-filter button').forEach((button) => button.classList.toggle('active', button === historyFilter));
    const visibleItems = state.historyItems.filter((item) => state.historyFilter === 'all' || (state.historyFilter === 'trades' ? ['buy', 'sell'].includes(item.type) : ['sent', 'received'].includes(item.type)));
    $('#history-list').innerHTML = visibleItems.length ? visibleItems.map(historyRow).join('') : '<div class="empty">No activity in this view.</div>';
    return;
  }
  const follow = event.target.closest('[data-follow]');
  if (follow) { const payload = await api(`/api/users/${follow.dataset.follow}/follow`, { method: 'POST' }); follow.classList.toggle('active', payload.following); follow.textContent = payload.following ? 'Following' : 'Follow'; return; }
  const profile = event.target.closest('[data-profile]'); if (profile) { openProfile(profile.dataset.profile); }
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('.inline-comment-form');
  if (!form) return;
  event.preventDefault(); submitInlineComment(form);
});

$$('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.auth-tab').forEach((item) => item.classList.toggle('active', item === tab));
  $('#login-form').classList.toggle('hidden', tab.dataset.authTab !== 'login');
  $('#register-form').classList.toggle('hidden', tab.dataset.authTab !== 'register');
}));
$('#login-form').addEventListener('submit', (event) => submitAuth(event, 'login'));
$('#register-form').addEventListener('submit', (event) => submitAuth(event, 'register'));
$('#global-search').addEventListener('input', (event) => { state.search = event.target.value; if (state.route === 'markets') renderMarkets(); });
$('#global-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') navigate('markets'); });
$('#mobile-menu').addEventListener('click', () => {
  const open = !$('.sidebar').classList.contains('open');
  $('.sidebar').classList.toggle('open', open); $('#sidebar-scrim').classList.toggle('open', open);
  $('#mobile-menu').setAttribute('aria-expanded', String(open));
});
$('#sidebar-scrim').addEventListener('click', closeNavigation);
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#global-search').focus(); }
  if (event.key === 'Escape') closeModal();
});

(async function boot() {
  try {
    const payload = await api('/api/session');
    if (payload.user) await enterApp();
  } catch (error) { console.error(error); }
})();
