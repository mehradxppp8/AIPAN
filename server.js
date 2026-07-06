const { Miniflare } = require("miniflare");

const mf = new Miniflare({
  scriptPath: "./_worker.js",
  modules: true,
  port: process.env.PORT || 3000,
  bindings: {
    MASTER_KEY: process.env.ADMIN_PASS || "admin",
    // سایر binding ها
  }
});

mf.listen().then(() => {
  console.log(`🚀 AIPAN (via Miniflare) running on port ${process.env.PORT || 3000}`);
});
