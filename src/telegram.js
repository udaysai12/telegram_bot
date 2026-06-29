const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');

// Initialize StringSession (empty is fine for bot accounts)
const stringSession = new StringSession('');

// Create TelegramClient instance
const client = new TelegramClient(stringSession, config.telegramApiId, config.telegramApiHash, {
  connectionRetries: 5,
});

/**
 * Starts the GramJS client and authenticates it as a Bot Account.
 */
async function startTelegramClient() {
  console.log('[Telegram] Authenticating Bot Client...');
  await client.start({
    botAuthToken: config.botToken,
  });
  console.log('[Telegram] Bot Client connected and authorized successfully!');
}

/**
 * Streams media directly to a local file using client.downloadMedia.
 * Prevents memory exhaustion for large files (1GB - 2GB).
 * 
 * @param {object} media - The message media object to download.
 * @param {string} localPath - The destination path on the local filesystem.
 * @param {function} onProgress - Progress callback receiving (downloadedBytes, totalBytes).
 */
async function downloadTelegramFile(media, localPath, onProgress) {
  // Throttle progress updates to avoid spamming the logs/Telegram API
  let lastProgressUpdate = 0;
  const updateIntervalMs = 2000; // Update at most every 2 seconds

  await client.downloadMedia(media, {
    outputFile: localPath,
    progressCallback: (downloadedBytes, totalBytes) => {
      const now = Date.now();
      const total = totalBytes || 0;
      
      if (now - lastProgressUpdate > updateIntervalMs || downloadedBytes === total) {
        lastProgressUpdate = now;
        if (onProgress && typeof onProgress === 'function') {
          onProgress({
            downloadedBytes,
            totalBytes: total,
            percentage: total > 0 ? ((downloadedBytes / total) * 100).toFixed(1) : '0.0',
          });
        }
      }
    },
  });
}

/**
 * Generates a clean text progress bar representation.
 * 
 * @param {number|string} percentage - Percentage complete.
 * @param {number} totalBytes - Total size of the file in bytes.
 * @returns {string} Text progress bar.
 */
function formatProgressBar(percentage, totalBytes) {
  const percentNum = parseFloat(percentage);
  const sizeMB = totalBytes ? (totalBytes / (1024 * 1024)).toFixed(2) : 'N/A';
  const barLength = 10;
  const filledLength = Math.min(barLength, Math.max(0, Math.round((percentNum / 100) * barLength)));
  const emptyLength = barLength - filledLength;
  
  const filledBar = '█'.repeat(filledLength);
  const emptyBar = '░'.repeat(emptyLength);
  
  return `[${filledBar}${emptyBar}] ${percentNum.toFixed(1)}% (${sizeMB} MB)`;
}

module.exports = {
  client,
  startTelegramClient,
  downloadTelegramFile,
  formatProgressBar,
};
