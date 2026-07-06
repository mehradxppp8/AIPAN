const { Miniflare } = require("miniflare");
const path = require("path");
const fs = require("fs");

// خواندن تنظیمات از متغیرهای محیطی Railway
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const API_ROUTE = process.env.API_ROUTE || "sync"; // مسیر پیش‌فرض Nahan

// بررسی وجود فایل _worker.js
const workerPath = path.join(__dirname, "_worker.js");
if (!fs.existsSync(workerPath)) {
    console.error("❌ Error: _worker.js not found in project root!");
    process.exit(1);
}

console.log(`📂 Loading worker from: ${workerPath}`);
console.log(`🔑 Admin Password: ${ADMIN_PASS}`);
console.log(`🛣️  API Route: /${API_ROUTE}`);

// راه‌اندازی Miniflare برای اجرای _worker.js
const mf = new Miniflare({
    scriptPath: workerPath,
    modules: true,
    port: PORT,
    host: "0.0.0.0", // لازم برای دسترسی خارجی در Railway
    
    // شبیه‌سازی KV و D1 با حافظه موقت یا SQLite
    // برای دیتابیس دائمی روی Railway، بهتر است از D1 واقعی CF استفاده کنید
    // اما اینجا برای تست اولیه از حافظه استفاده می‌کنیم
    kvNamespaces: ["IOT_DB"], 
    
    // متغیرهای محیطی که _worker.js نیاز دارد
    bindings: {
        MASTER_KEY: ADMIN_PASS,
        API_ROUTE: API_ROUTE,
        // سایر متغیرهای مورد نیاز را اینجا اضافه کنید
    },

    // فعال کردن WebSocket برای پروتکل‌های VLESS/Trojan
    webSockets: true,
    
    // لاگ‌های داخلی ورکر
    log: console,
});

// شروع سرور
mf.listen().then((server) => {
    console.log(`🚀 AIPAN Panel (Nahan Core) running on port ${PORT}`);
    console.log(`🔗 Login URL: http://localhost:${PORT}/${API_ROUTE}/dash`);
    console.log(`⚠️  Note: Use '/${API_ROUTE}/dash' for dashboard, not '/dash'`);
}).catch((err) => {
    console.error("❌ Failed to start Miniflare:", err);
    process.exit(1);
});

// هندل کردن سیگنال‌های خروج برای بستن تمیز سرور
process.on("SIGTERM", () => {
    console.log("🛑 Received SIGTERM, shutting down...");
    mf.dispose();
    process.exit(0);
});
