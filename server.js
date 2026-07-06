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
const DB_PATH = process.env.DB_PATH || path.join('/app/data', 'aipan.db');

// --- Database Setup (SQLite for Railway) ---
if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize Tables
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

// Load System Config
let sysConfig = getConfig('sys_config', { 
    masterKey: ADMIN_PASS, 
    apiRoute: 'sync', 
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

// Middleware Auth
const authenticate = (req, res, next) => {
    const key = req.headers['authorization']?.replace('Bearer ', '') || 
                req.query.key || 
                (req.body && req.body.key);
    if (key === sysConfig.masterKey) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized' });
};

// --- Routes ---

// 1. Login Page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Dashboard (Protected)
app.get('/dash', authenticate, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Root Redirect
app.get('/', (req, res) => res.redirect('/login'));

// 4. Auth API
app.post('/sync/api/auth', async (req, res) => {
    const { key } = req.body;
    if (key === sysConfig.masterKey) {
        return res.json({
            success: true,
            deviceId: 'railway-node-01',
            network: { ip: '127.0.0.1', colo: 'RAIL', loc: 'US-East' },
            config: { ...sysConfig, masterKey: '[PROTECTED]' },
            profiles: [{ id: sysConfig.deviceId || 'default', name: 'Default', sync: `https://${req.headers.host}/${sysConfig.apiRoute}` }]
        });
    }
    res.status(401).json({ success: false });
});

// 5. Users API
app.all('/sync/api/users', authenticate, (req, res) => {
    const method = req.method;
    
    // GET Users
    if (method === 'GET') {
        const users = db.prepare('SELECT * FROM users').all();
        return res.json({ success: true, users });
    }

    // POST Add User
    if (method === 'POST' && !req.query.id) {
        const { name, trafficLimit, expiryDays } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Name required' });
        
        const id = uuidv4();
        const limitTotalReq = trafficLimit ? Math.floor(parseFloat(trafficLimit) * 6000) : null;
        const expiryMs = expiryDays ? Date.now() + (parseInt(expiryDays) * 86400000) : null;
        
        db.prepare('INSERT INTO users (id, name, limitTotalReq, expiryMs, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, name, limitTotalReq, expiryMs, Date.now());
        
        // Update in-memory config
        sysConfig.users.push({ id, name, limitTotalReq, expiryMs, isPaused: false, createdAt: Date.now() });
        setConfig('sys_config', sysConfig);
        
        return res.status(201).json({ success: true, user: { id, name, limitTotalReq, expiryMs } });
    }

    // DELETE User
    if (method === 'DELETE' && req.query.id) {
        const id = req.query.id;
        db.prepare('DELETE FROM users WHERE id=?').run(id);
        sysConfig.users = sysConfig.users.filter(u => u.id !== id);
        setConfig('sys_config', sysConfig);
        return res.json({ success: true });
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
});

// 6. Sync API (For saving dashboard settings)
app.post('/sync/api/sync', authenticate, (req, res) => {
    const { config } = req.body;
    if (config) {
        // Merge incoming config with existing users to prevent data loss
        config.users = sysConfig.users; 
        sysConfig = { ...sysConfig, ...config };
        setConfig('sys_config', sysConfig);
    }
    res.json({ success: true, newRoute: sysConfig.apiRoute });
});

// 7. Subscription Endpoint (Basic Support)
app.get('/sync', (req, res) => {
    const sub = req.query.sub;
    let targetUser = null;
    
    if (sub && sysConfig.users) {
        targetUser = sysConfig.users.find(u => u.name.toLowerCase() === sub.toLowerCase() || u.id === sub);
    }
    
    // If no specific user or multi-user disabled, return basic info or maintenance
    if (!targetUser && sysConfig.users && sysConfig.users.length > 0) {
        return res.status(403).send('Multi-user active. Specify ?sub=name');
    }

    // Return a simple text response or redirect to maintenance as per Nahan logic
    // For Railway, we usually just return a placeholder or the actual config if implemented
    res.set('Content-Type', 'text/plain');
    res.send('# AIPAN Panel on Railway\n# Use /sync?sub=NAME for subscription');
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(` AIPAN Panel (Node Native) running on port ${PORT}`);
    console.log(`🔑 Login: http://localhost:${PORT}/login`);
    console.log(`📊 Dash:  http://localhost:${PORT}/dash`);
});
