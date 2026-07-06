const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const API_ROUTE = process.env.API_ROUTE || 'sync'; // مسیر پیش‌فرض Nahan
const DB_PATH = process.env.DB_PATH || path.join('/app/data', 'aipan.db');

// --- Database Setup (SQLite for Railway) ---
if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize Tables matching Nahan structure
db.exec(`
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, limitTotalReq INTEGER, expiryMs INTEGER, isPaused BOOLEAN DEFAULT 0, disabledReason TEXT, createdAt INTEGER);
  CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, type TEXT, detail TEXT);
`);

// Helper to get/set config from SQLite (mimicking KV)
const getConfig = (key, defaultVal) => {
    const row = db.prepare('SELECT value FROM config WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : defaultVal;
};
const setConfig = (key, val) => {
    db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(val));
};

// Load System Config with defaults from _worker.js SYSTEM_DEFAULTS
let sysConfig = getConfig('sys_config', { 
    masterKey: ADMIN_PASS, 
    apiRoute: API_ROUTE, 
    users: [], 
    isPaused: false,
    mode: 'alpha',
    socketPorts: '443'
});

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware Auth (matching extractAuthKey logic)
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const authKey = authHeader.replace('Bearer ', '') || '';
    let bodyKey = '';
    if (req.body && typeof req.body === 'object') bodyKey = req.body.key || '';
    const urlKey = req.query.key || '';
    
    const key = authKey || bodyKey || urlKey;
    
    if (key === sysConfig.masterKey || isPanelApiKey(key)) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized' });
};

function isPanelApiKey(key) {
    if (!key || !sysConfig.panelApiKeys || !Array.isArray(sysConfig.panelApiKeys)) return false;
    return sysConfig.panelApiKeys.some((k) => k.key === key);
}

// --- Routes ---

// 1. Root & Login Redirects
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 2. Dashboard Route (Protected)
app.get(`/${API_ROUTE}/dash`, authenticate, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Auth API (Matching handleAuth)
app.post(`/${API_ROUTE}/api/auth`, async (req, res) => {
    const { key } = req.body;
    if (key === sysConfig.masterKey || isPanelApiKey(key)) {
        return res.json({
            success: true,
            deviceId: sysConfig.deviceId || generateHardwareId(sysConfig.apiRoute),
            network: { ip: req.ip, colo: 'RAILWAY', loc: 'US-East' },
            config: { ...sysConfig, masterKey: '[PROTECTED]' },
            profiles: [{ id: sysConfig.deviceId || 'default', name: 'Default', sync: `${req.protocol}://${req.headers.host}/${sysConfig.apiRoute}` }]
        });
    }
    res.status(401).json({ success: false });
});

// 4. Users API (Matching handleUsersApi)
app.all(`/${API_ROUTE}/api/users`, authenticate, (req, res) => {
    const method = req.method;
    const userId = req.query.id;
    
    // GET Users
    if (method === 'GET' && !userId) {
        const users = db.prepare('SELECT * FROM users').all();
        return res.json({ success: true, users });
    }

    // POST Add User
    if (method === 'POST' && !userId) {
        const { name, trafficLimit, expiryDays } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Name required' });
        
        const id = uuidv4();
        const limitTotalReq = trafficLimit ? Math.floor(parseFloat(trafficLimit) * 6000) : null;
        const expiryMs = expiryDays ? Date.now() + (parseInt(expiryDays) * 86400000) : null;
        
        db.prepare('INSERT INTO users (id, name, limitTotalReq, expiryMs, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, name, limitTotalReq, expiryMs, Date.now());
        
        sysConfig.users.push({ id, name, limitTotalReq, expiryMs, isPaused: false, createdAt: Date.now() });
        setConfig('sys_config', sysConfig);
        
        return res.status(201).json({ success: true, user: { id, name, limitTotalReq, expiryMs } });
    }

    // DELETE User
    if (method === 'DELETE' && userId) {
        db.prepare('DELETE FROM users WHERE id=?').run(userId);
        sysConfig.users = sysConfig.users.filter(u => u.id !== userId);
        setConfig('sys_config', sysConfig);
        return res.json({ success: true });
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
});

// 5. Sync API (For saving dashboard settings)
app.post(`/${API_ROUTE}/api/sync`, authenticate, (req, res) => {
    const { config } = req.body;
    if (config) {
        config.users = sysConfig.users; // Preserve users during sync
        sysConfig = { ...sysConfig, ...config };
        setConfig('sys_config', sysConfig);
    }
    res.json({ success: true, newRoute: sysConfig.apiRoute });
});

// 6. Subscription Endpoint (Basic Support)
app.get(`/${API_ROUTE}`, (req, res) => {
    const sub = req.query.sub;
    let targetUser = null;
    
    if (sub && sysConfig.users) {
        targetUser = sysConfig.users.find(u => u.name.toLowerCase() === sub.toLowerCase() || u.id === sub);
    }
    
    if (!targetUser && sysConfig.users && sysConfig.users.length > 0) {
        return res.status(403).send('Multi-user active. Specify ?sub=name');
    }

    res.set('Content-Type', 'text/plain');
    res.send('# AIPAN Panel on Railway\n# Use /sync?sub=NAME for subscription');
});

// Helper Functions
function generateHardwareId(seed) {
    const h20 = Array.from(new TextEncoder().encode(seed))
        .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20).padEnd(20, "0");
    return `${h20.slice(0, 8)}-0000-4000-8000-${h20.slice(-12)}`;
}

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 AIPAN Panel (Node Native Wrapper) running on port ${PORT}`);
    console.log(`🔑 Login URL: http://localhost:${PORT}/login`);
    console.log(`📊 Dash URL: http://localhost:${PORT}/${API_ROUTE}/dash`);
});
