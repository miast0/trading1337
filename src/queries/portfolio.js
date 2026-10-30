function createPortfolioQueries(db) {
  function portfolioFor(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return null;
    const holdings = db.prepare(`
      SELECT a.id AS assetId, a.symbol, a.name, a.color, a.provider_id AS providerId,
             a.category, a.source, a.icon_url AS iconUrl,
             a.last_price_cents AS priceCents, a.change_24h AS change24h,
             h.quantity, h.average_cost_cents AS averageCostCents
      FROM holdings h JOIN assets a ON a.id = h.asset_id
      WHERE h.user_id = ? AND h.quantity > 0.00000001
      ORDER BY (h.quantity * a.last_price_cents) DESC
    `).all(userId).map((row) => ({
      ...row,
      valueCents: Math.round(row.quantity * row.priceCents),
      costCents: Math.round(row.quantity * row.averageCostCents),
      returnCents: Math.round(row.quantity * (row.priceCents - row.averageCostCents)),
      returnPercent: row.averageCostCents ? ((row.priceCents / row.averageCostCents) - 1) * 100 : 0,
    }));
    const investedCents = holdings.reduce((sum, item) => sum + item.valueCents, 0);
    const costCents = holdings.reduce((sum, item) => sum + item.costCents, 0);
    return { cashCents: user.cash_cents, investedCents, totalCents: user.cash_cents + investedCents, returnCents: investedCents - costCents, holdings };
  }

  const refreshedUserStatement = db.prepare('SELECT * FROM users WHERE id = ?');
  function refreshedUser(userId) {
    return refreshedUserStatement.get(userId);
  }

  const recentTradesStatement = db.prepare(`SELECT t.id, t.side, t.quantity, t.total_cents AS totalCents, t.created_at AS createdAt,
      t.price_cents AS priceCents, a.id AS assetId, a.symbol, a.name AS assetName,
      a.provider_id AS providerId, a.icon_url AS iconUrl, a.color AS assetColor,
      a.last_price_cents AS currentPriceCents, a.change_24h AS change24h
      FROM trades t JOIN assets a ON a.id = t.asset_id
      WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 10`);
  function recentTrades(userId) {
    return recentTradesStatement.all(userId);
  }

  const watchlistStatement = db.prepare('SELECT asset_id AS assetId FROM watchlist WHERE user_id = ?');
  function watchlist(userId) {
    return watchlistStatement.all(userId);
  }

  const watchExistsStatement = db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND asset_id = ?');
  function watchExists(userId, assetId) {
    return watchExistsStatement.get(userId, assetId);
  }

  const deleteWatchStatement = db.prepare('DELETE FROM watchlist WHERE user_id = ? AND asset_id = ?');
  function deleteWatch(userId, assetId) {
    return deleteWatchStatement.run(userId, assetId);
  }

  const insertWatchStatement = db.prepare('INSERT INTO watchlist(user_id, asset_id) VALUES (?, ?)');
  function insertWatch(userId, assetId) {
    return insertWatchStatement.run(userId, assetId);
  }

  return { portfolioFor, refreshedUser, recentTrades, watchlist, watchExists, deleteWatch, insertWatch };
}

module.exports = { createPortfolioQueries };
