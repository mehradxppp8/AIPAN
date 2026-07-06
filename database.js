const Database = require('better-sqlite3');
const path = require('path');

// تغییر مسیر به پوشه Volume که در Railway ساختید
// اگر متغیر محیطی DB_PATH ست نشده باشد، از مسیر پیش‌فرض /app/data استفاده می‌کند
const DB_PATH = process.env.DB_PATH || path.join('/app/data', 'aipan.db');

const db = new Database(DB_PATH);

// بقیه کد مثل قبل...
db.pragma('journal_mode = WAL');
// ...
