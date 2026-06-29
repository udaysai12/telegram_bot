const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Helper to parse numbers
const parseNumber = (val, defaultVal) => {
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
};

// Parse admin IDs as an array of integers
const parseAdminIds = (val) => {
  if (!val) return [];
  return val
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
};

const config = {
  botToken: process.env.BOT_TOKEN,
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS 
    ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS) 
    : null,
  adminIds: parseAdminIds(process.env.ADMIN_IDS),
  port: parseNumber(process.env.PORT, 3000),
  telegramApiId: parseNumber(process.env.TELEGRAM_API_ID, null),
  telegramApiHash: process.env.TELEGRAM_API_HASH,
  maxConcurrentUploads: parseNumber(process.env.MAX_CONCURRENT_UPLOADS, 1),
  // Resumable upload chunk size. Google Drive requires it to be a multiple of 256 KB.
  // We default to 10 MB.
  chunkSize: parseNumber(process.env.CHUNK_SIZE_MB, 10) * 1024 * 1024,
};

// Validate required configurations
const missingConfig = [];
if (!config.botToken || config.botToken === 'your_telegram_bot_token') {
  missingConfig.push('BOT_TOKEN');
}
if (!config.driveFolderId || config.driveFolderId === 'your_google_drive_folder_id') {
  missingConfig.push('GOOGLE_DRIVE_FOLDER_ID');
}
if (!config.credentialsPath || !fs.existsSync(config.credentialsPath)) {
  missingConfig.push('GOOGLE_APPLICATION_CREDENTIALS');
}
if (!config.telegramApiId) {
  missingConfig.push('TELEGRAM_API_ID');
}
if (!config.telegramApiHash) {
  missingConfig.push('TELEGRAM_API_HASH');
}

if (missingConfig.length > 0) {
  console.warn(`[WARNING] Missing or default configurations for: ${missingConfig.join(', ')}`);
  console.warn('[WARNING] Please configure these in your .env file to enable full bot functionality.');
}

if (config.adminIds.length === 0) {
  console.warn('[WARNING] ADMIN_IDS is not configured in .env. The bot will run in strict private mode, rejecting all upload requests, but will allow users to query their User ID via /start.');
}

module.exports = config;
