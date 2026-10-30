function createTradingService(db, queries) {
  function executeTrade(userId, assetId, side, amount, sourceTradeId = null) {
    const asset = queries.trading.asset(assetId);
    if (!asset) throw new Error('Asset not found.');
    if (!['buy', 'sell'].includes(side)) throw new Error('Choose buy or sell.');
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('Enter an amount greater than zero.');
    const euroCents = side === 'buy' ? Math.round(numericAmount * 100) : Math.round(numericAmount * asset.last_price_cents);
    if (euroCents <= 0) throw new Error('Enter an amount greater than zero.');
    const quantity = side === 'buy' ? euroCents / asset.last_price_cents : numericAmount;
    const user = queries.trading.userBalance(userId);
    const holding = queries.trading.holding(userId, assetId);

    db.exec('BEGIN IMMEDIATE');
    try {
      if (side === 'buy') {
        if (user.cash_cents < euroCents) throw new Error('Insufficient EUR balance.');
        queries.trading.debitCash(euroCents, userId);
        if (holding) {
          const newQuantity = holding.quantity + quantity;
          const newAverage = Math.round((holding.quantity * holding.average_cost_cents + euroCents) / newQuantity);
          queries.trading.setHolding(newQuantity, newAverage, userId, assetId);
        } else {
          queries.trading.insertHolding(userId, assetId, quantity, asset.last_price_cents);
        }
      } else {
        if (!holding || holding.quantity + 1e-12 < quantity) throw new Error(`Insufficient ${asset.symbol} balance.`);
        queries.trading.debitHolding(quantity, userId, assetId);
        queries.trading.creditCash(euroCents, userId);
      }
      const result = queries.trading.insertTrade(userId, assetId, side, quantity, asset.last_price_cents, euroCents, sourceTradeId);
      db.exec('COMMIT');
      const trade = queries.trading.tradeResult(Number(result.lastInsertRowid));
      return trade;
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  function transfer(userId, body) {
    const walletAddress = String(body.walletAddress || '').trim();
    const recipient = queries.trading.transferRecipient(walletAddress);
    if (!recipient || recipient.id === userId) throw new Error('Enter another valid wallet ID.');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount.');
    const assetId = Number(body.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) throw new Error('Choose a cryptocurrency to transfer.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const asset = queries.trading.cryptoAsset(assetId);
      if (!asset) throw new Error('Only cryptocurrency can be transferred.');
      const holding = queries.trading.transferBalance(userId, assetId);
      if (!holding || holding.quantity < amount) throw new Error(`Insufficient ${asset.symbol} balance.`);
      queries.trading.debitTransfer(amount, userId, assetId);
      const recipientHolding = queries.trading.recipientHolding(recipient.id, assetId);
      if (recipientHolding) {
        const newQuantity = recipientHolding.quantity + amount;
        const newAverage = Math.round((recipientHolding.quantity * recipientHolding.average_cost_cents + amount * asset.last_price_cents) / newQuantity);
        queries.trading.setRecipientHolding(newQuantity, newAverage, recipient.id, assetId);
      } else {
        queries.trading.insertRecipientHolding(recipient.id, assetId, amount, asset.last_price_cents);
      }
      queries.trading.recordTransfer(userId, recipient.id, assetId, amount);
      db.exec('COMMIT');
      return;
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  return { executeTrade, transfer };
}

module.exports = { createTradingService };
