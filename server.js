const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const config = require('./config');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
// سرو کردن فایل‌های استاتیک (CSS, JS, Images)
app.use(express.static(path.join(__dirname, 'public')));

// --- Middleware احراز هویت ---
const authenticate = (req, res, next) => {
    // چک کردن کوکی یا هدر برای توکن
    const token = req.headers['authorization']?.replace('Bearer ', '') || req.cookies?.token;
    
    if (token === config.ADMIN_PASSWORD) {
        return next();
    }
    
    // اگر توکن نبود یا غلط بود، کاربر را به لاگین بفرست
    return res.redirect('/login?error=unauthorized');
};

// --- Routes ---

// 1. صفحه لاگین (بدون نیاز به رمز)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 2. API لاگین (چک کردن رمز)
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === config.ADMIN_PASSWORD) {
        // در یک پروژه واقعی بهتر است از JWT استفاده شود، اما اینجا برای سادگی خود رمز را برمی‌گردانیم
        res.json({ success: true, token: config.ADMIN_PASSWORD });
    } else {
        res.status(401).json({ success: false, message: 'رمز عبور اشتباه است' });
    }
});

// 3. صفحه داشبورد (نیاز به رمز دارد)
app.get('/dash', authenticate, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 4. ریدایرکت ریشه به لاگین
app.get('/', (req, res) => {
    res.redirect('/login');
});

// --- API Routes (همگی نیاز به رمز دارند) ---

// دریافت لیست کاربران
app.get('/api/users', authenticate, (req, res) => {
    try {
        const users = db.prepare('SELECT * FROM users').all();
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// افزودن کاربر
app.post('/api/users', authenticate, (req, res) => {
    const { name, traffic_limit, expiry_days } = req.body;
    const id = uuidv4();
    const uuid = uuidv4();
    const expiry_date = expiry_days ? Date.now() + (expiry_days * 86400000) : null;
    
    try {
        db.prepare('INSERT INTO users (id, name, uuid, traffic_limit, expiry_date) VALUES (?, ?, ?, ?, ?)')
          .run(id, name, uuid, traffic_limit || 0, expiry_date);
        res.json({ success: true, id, uuid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// حذف کاربر
app.delete('/api/users/:id', authenticate, (req, res) => {
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// تولید لینک سابسکریپشن (عمومی - بدون نیاز به لاگین ادمین)
app.get(`/sub/:uuid`, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(req.params.uuid);
    if (!user) return res.status(404).send('Not Found');

    // اینجا منطق تولید کانفیگ VLESS/TROJAN قرار می‌گیرد
    const fakeConfig = `vless://${user.uuid}@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&path=/aipan#${user.name}`;
    
    res.set('Content-Type', 'text/plain');
    res.send(Buffer.from(fakeConfig).toString('base64'));
});

app.listen(config.PORT, () => {
    console.log(`🚀 AIPAN Panel running on port ${config.PORT}`);
    console.log(`🔑 Login at: http://localhost:${config.PORT}/login`);
});

// انتهای فایل server.js را با این کد جایگزین کنید
const PORT = process.env.PORT || config.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 AIPAN Panel running on port ${PORT}`);
    console.log(`🔑 Login at: http://localhost:${PORT}/login`);
});
