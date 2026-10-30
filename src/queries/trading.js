function createTradingQueries(db) {
  const assetStatement = db.prepare('SELECT * FROM assets WHERE id = ?');
  function asset(assetId) {
    return assetStatement.get(assetId);
  }

  const userBalanceStatement = db.prepare('SELECT * FROM users WHERE id = ?');
  function userBalance(userId) {
    return userBalanceStatement.get(userId);
  }

  const holdingStatement = db.prepare('SELECT * FROM holdings WHERE user_id = ? AND asset_id = ?');
  function holding(userId, assetId) {
    return holdingStatement.get(userId, assetId);
  }

  const debitCashStatement = db.prepare('UPDATE users SET cash_cents = cash_cents - ? WHERE id = ?');
  function debitCash(amount, userId) {
    return debitCashStatement.run(amount, userId);
  }

  const setHoldingStatement = db.prepare('UPDATE holdings SET quantity = ?, average_cost_cents = ? WHERE user_id = ? AND asset_id = ?');
  function setHolding(quantity, averageCostCents, userId, assetId) {
    return setHoldingStatement.run(quantity, averageCostCents, userId, assetId);
  }

  const insertHoldingStatement = db.prepare('INSERT INTO holdings(user_id, asset_id, quantity, average_cost_cents) VALUES (?, ?, ?, ?)');
  function insertHolding(userId, assetId, quantity, priceCents) {
    return insertHoldingStatement.run(userId, assetId, quantity, priceCents);
  }

  const debitHoldingStatement = db.prepare('UPDATE holdings SET quantity = quantity - ? WHERE user_id = ? AND asset_id = ?');
  function debitHolding(quantity, userId, assetId) {
    return debitHoldingStatement.run(quantity, userId, assetId);
  }

  const creditCashStatement = db.prepare('UPDATE users SET cash_cents = cash_cents + ? WHERE id = ?');
  function creditCash(amount, userId) {
    return creditCashStatement.run(amount, userId);
  }

  const insertTradeStatement = db.prepare('INSERT INTO trades(user_id, asset_id, side, quantity, price_cents, total_cents, source_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  function insertTrade(userId, assetId, side, quantity, priceCents, totalCents, sourceTradeId) {
    return insertTradeStatement.run(userId, assetId, side, quantity, priceCents, totalCents, sourceTradeId);
  }

  const tradeResultStatement = db.prepare(`SELECT t.id, t.side, t.quantity, t.price_cents AS priceCents,
        t.total_cents AS totalCents, t.created_at AS createdAt, a.id AS assetId, a.symbol,
        a.name AS assetName, a.color AS assetColor, a.provider_id AS providerId,
        a.icon_url AS iconUrl, a.category, a.last_price_cents AS currentPriceCents,
        a.change_24h AS change24h FROM trades t JOIN assets a ON a.id = t.asset_id WHERE t.id = ?`);
  function tradeResult(tradeId) {
    return tradeResultStatement.get(tradeId);
  }

  const transferRecipientStatement = db.prepare('SELECT * FROM users WHERE wallet_address = ? COLLATE NOCASE');
  function transferRecipient(walletAddress) {
    return transferRecipientStatement.get(walletAddress);
  }

  const cryptoAssetStatement = db.prepare("SELECT * FROM assets WHERE id = ? AND category = 'crypto'");
  function cryptoAsset(assetId) {
    return cryptoAssetStatement.get(assetId);
  }

  const transferBalanceStatement = db.prepare('SELECT quantity FROM holdings WHERE user_id = ? AND asset_id = ?');
  function transferBalance(userId, assetId) {
    return transferBalanceStatement.get(userId, assetId);
  }

  const debitTransferStatement = db.prepare('UPDATE holdings SET quantity = quantity - ? WHERE user_id = ? AND asset_id = ?');
  function debitTransfer(amount, userId, assetId) {
    return debitTransferStatement.run(amount, userId, assetId);
  }

  const recipientHoldingStatement = db.prepare('SELECT quantity, average_cost_cents FROM holdings WHERE user_id = ? AND asset_id = ?');
  function recipientHolding(userId, assetId) {
    return recipientHoldingStatement.get(userId, assetId);
  }

  const setRecipientHoldingStatement = db.prepare('UPDATE holdings SET quantity = ?, average_cost_cents = ? WHERE user_id = ? AND asset_id = ?');
  function setRecipientHolding(quantity, averageCostCents, userId, assetId) {
    return setRecipientHoldingStatement.run(quantity, averageCostCents, userId, assetId);
  }

  const insertRecipientHoldingStatement = db.prepare('INSERT INTO holdings(user_id, asset_id, quantity, average_cost_cents) VALUES (?, ?, ?, ?)');
  function insertRecipientHolding(userId, assetId, quantity, priceCents) {
    return insertRecipientHoldingStatement.run(userId, assetId, quantity, priceCents);
  }

  const recordTransferStatement = db.prepare('INSERT INTO transfers(sender_id, recipient_id, asset_id, amount) VALUES (?, ?, ?, ?)');
  function recordTransfer(senderId, recipientId, assetId, amount) {
    return recordTransferStatement.run(senderId, recipientId, assetId, amount);
  }

  return { asset, userBalance, holding, debitCash, setHolding, insertHolding, debitHolding, creditCash, insertTrade, tradeResult, transferRecipient, cryptoAsset, transferBalance, debitTransfer, recipientHolding, setRecipientHolding, insertRecipientHolding, recordTransfer };
}

module.exports = { createTradingQueries };
