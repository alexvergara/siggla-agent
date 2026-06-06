// PM2 process definition.
//   pm2 start ecosystem.config.cjs
//   pm2 logs siggla-agent     # watch logs (scan the QR on first run)
//   pm2 save && pm2 startup    # survive reboots
//
// Env comes from .env in this directory (loaded by dotenv at startup).
module.exports = {
  apps: [
    {
      name: 'siggla-agent',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
