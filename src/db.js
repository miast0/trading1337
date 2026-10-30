const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { avatarColor } = require('./services/avatar');

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function generateWalletAddress() {
  return `0x${crypto.randomBytes(20).toString('hex')}`;
}

function openDatabase() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'trading1337.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      wallet_address TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#78e7bc',
      cash_cents INTEGER NOT NULL DEFAULT 10000,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'crypto',
      source TEXT NOT NULL DEFAULT 'CoinGecko',
      icon_url TEXT NOT NULL DEFAULT '',
      last_price_cents INTEGER NOT NULL,
      change_24h REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_history_cache (
      provider_id TEXT PRIMARY KEY,
      points_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      quantity REAL NOT NULL DEFAULT 0,
      average_cost_cents INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      side TEXT NOT NULL CHECK(side IN ('buy','sell')),
      quantity REAL NOT NULL,
      price_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      source_trade_id INTEGER REFERENCES trades(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      recipient_id INTEGER NOT NULL REFERENCES users(id),
      asset_id INTEGER REFERENCES assets(id),
      amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, followed_id)
    );
    CREATE TABLE IF NOT EXISTS likes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, trade_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      referenced_asset_id INTEGER REFERENCES assets(id),
      embedded_trade_id INTEGER REFERENCES trades(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS community_post_likes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS community_post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_trade ON comments(trade_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
    CREATE INDEX IF NOT EXISTS idx_community_posts_created ON community_posts(created_at DESC, id DESC);
  `);

  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'email')) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
    db.exec("UPDATE users SET email = username || '@invalid.local' WHERE email IS NULL;");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);');
  }
  if (!userColumns.some((column) => column.name === 'wallet_address')) {
    db.exec('ALTER TABLE users ADD COLUMN wallet_address TEXT;');
    const users = db.prepare('SELECT id FROM users WHERE wallet_address IS NULL').all();
    const updateWallet = db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?');
    users.forEach((user) => updateWallet.run(generateWalletAddress(), user.id));
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address COLLATE NOCASE);');
  }

  const assetColumns = db.prepare('PRAGMA table_info(assets)').all();
  if (!assetColumns.some((column) => column.name === 'category')) db.exec("ALTER TABLE assets ADD COLUMN category TEXT NOT NULL DEFAULT 'crypto';");
  if (!assetColumns.some((column) => column.name === 'source')) db.exec("ALTER TABLE assets ADD COLUMN source TEXT NOT NULL DEFAULT 'CoinGecko';");
  if (!assetColumns.some((column) => column.name === 'icon_url')) db.exec("ALTER TABLE assets ADD COLUMN icon_url TEXT NOT NULL DEFAULT '';");

  for (const [column, type] of [['market_cap_cents', 'INTEGER'], ['volume_24h_cents', 'INTEGER'], ['change_7d', 'REAL']]) {
    if (!assetColumns.some((field) => field.name === column)) db.exec(`ALTER TABLE assets ADD COLUMN ${column} ${type};`);
  }

  // Backfill once; subsequent writes maintain totals in the same SQLite transaction.
  const counters = [
    ['users', 'follower_count', 'follows', 'followed_id'],
    ['users', 'following_count', 'follows', 'follower_id'],
    ['users', 'trade_count', 'trades', 'user_id'],
    ['users', 'post_count', 'community_posts', 'user_id'],
    ['trades', 'like_count', 'likes', 'trade_id'],
    ['trades', 'comment_count', 'comments', 'trade_id'],
    ['trades', 'copy_count', 'trades', 'source_trade_id'],
    ['community_posts', 'like_count', 'community_post_likes', 'post_id'],
    ['community_posts', 'comment_count', 'community_post_comments', 'post_id'],
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    const updateColor = db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?');
    for (const user of db.prepare('SELECT id, username, avatar_color FROM users').all()) {
      const color = avatarColor(user.username);
      if (color !== user.avatar_color) updateColor.run(color, user.id);
    }
    for (const [parent, column, child, foreignKey] of counters) {
      if (!db.prepare(`PRAGMA table_info(${parent})`).all().some((field) => field.name === column)) {
        db.exec(`ALTER TABLE ${parent} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0;
          UPDATE ${parent} SET ${column} = (SELECT COUNT(*) FROM ${child} WHERE ${foreignKey} = ${parent}.id);`);
      }
      const trigger = `${parent}_${column}`;
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${trigger}_insert AFTER INSERT ON ${child} BEGIN
          UPDATE ${parent} SET ${column} = ${column} + 1 WHERE id = NEW.${foreignKey}; END;
        CREATE TRIGGER IF NOT EXISTS ${trigger}_delete AFTER DELETE ON ${child} BEGIN
          UPDATE ${parent} SET ${column} = MAX(0, ${column} - 1) WHERE id = OLD.${foreignKey}; END;
        CREATE TRIGGER IF NOT EXISTS ${trigger}_update AFTER UPDATE OF ${foreignKey} ON ${child}
          WHEN OLD.${foreignKey} IS NOT NEW.${foreignKey} BEGIN
          UPDATE ${parent} SET ${column} = MAX(0, ${column} - 1) WHERE id = OLD.${foreignKey};
          UPDATE ${parent} SET ${column} = ${column} + 1 WHERE id = NEW.${foreignKey}; END;`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { openDatabase, migrate, passwordRecord, verifyPassword, generateWalletAddress };
