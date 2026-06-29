const express = require('express');
const config = require('./config');
const { startTelegramClient } = require('./telegram');
const { initBot } = require('./bot');

const app = express();

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/', (req, res) => {
  res.send('Telegram to Google Drive Uploader Bot is active and running.');
});

/**
 * Main application runner.
 */
async function main() {
  // 1. Start Telegram Client asynchronously
  try {
    await startTelegramClient();
    console.log('[Bot] Telegram bot client connected successfully!');
  } catch (error) {
    console.error('[Bot] Fatal error starting Telegram bot client:', error);
    process.exit(1);
  }

  // 2. Initialize Telegram message event handlers
  initBot();

  // 3. Start Express server for health checks
  app.listen(config.port, () => {
    console.log(`[Web Server] Running on port ${config.port}`);
    console.log(`[Web Server] Health endpoint: http://localhost:${config.port}/health`);
  });
}

main().catch((err) => {
  console.error('[Main] Fatal uncaught startup error:', err);
  process.exit(1);
});
