const Database = require('better-sqlite3');
const path = require('path');

// استفاده از دیتابیس در حافظه یا فایل (برای Railway بهتر است فایل باشد اما در env تنظیم شود)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'aipan.db');
const db = new Database(DB_PATH);

// جداول را ایجاد می‌کنیم
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    uuid TEXT NOT NULL UNIQUE,
    traffic_limit INTEGER DEFAULT 0,
    expiry_date INTEGER,
    is_paused BOOLEAN DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;