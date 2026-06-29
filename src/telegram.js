const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const sessionFilePath = path.resolve(__dirname, '../session.txt');
let sessionString = '';

if (fs.existsSync(sessionFilePath)) {
  try {
    sessionString = fs.readFileSync(sessionFilePath, 'utf8').trim();
    console.log('[Telegram] Loaded existing session string.');
  } catch (err) {
    console.error('[Telegram] Failed to read session.txt, starting fresh:', err.message);
  }
}

// Initialize StringSession
const stringSession = new StringSession(sessionString);

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
  
  try {
    const savedSession = client.session.save();
    fs.writeFileSync(sessionFilePath, savedSession, 'utf8');
    console.log('[Telegram] Bot Client connected and session saved successfully.');
  } catch (err) {
    console.error('[Telegram] Failed to save session string:', err.message);
  }
}

/**
 * Streams media directly to a local file using client.downloadFile with an
 * explicit dcId to avoid cross-DC AUTH_BYTES_INVALID errors.
 * 
 * @param {object} media - The message media object (MessageMediaDocument).
 * @param {string} localPath - The destination path on the local filesystem.
 * @param {function} onProgress - Progress callback receiving { downloadedBytes, totalBytes, percentage }.
 */
async function downloadTelegramFile(media, localPath, onProgress) {
  const { Api } = require('telegram');

  // Extract document from media
  const doc = media.document;
  if (!doc) {
    throw new Error('No document found in media object.');
  }

  const totalBytes = doc.size ? Number(doc.size.toString()) : 0;
  const dcId = doc.dcId;

  // Build the InputDocumentFileLocation
  const fileLocation = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: '',
  });

  // Throttle progress updates
  let lastProgressUpdate = 0;
  const updateIntervalMs = 2000;

  const outputStream = require('fs').createWriteStream(localPath);

  try {
    // Use downloadFile with explicit dcId and write stream
    const result = await client.downloadFile(fileLocation, {
      dcId: dcId,
      fileSize: totalBytes,
      outputFile: localPath,
      progressCallback: (receivedBytes) => {
        const now = Date.now();
        const received = Number(receivedBytes.toString());

        if (now - lastProgressUpdate > updateIntervalMs || received >= totalBytes) {
          lastProgressUpdate = now;
          if (onProgress && typeof onProgress === 'function') {
            onProgress({
              downloadedBytes: received,
              totalBytes,
              percentage: totalBytes > 0 ? ((received / totalBytes) * 100).toFixed(1) : '0.0',
            });
          }
        }
      },
    });

    // result might be a Buffer if outputFile is not correctly handled
    if (Buffer.isBuffer(result) && result.length > 0) {
      require('fs').writeFileSync(localPath, result);
    }
  } finally {
    try { outputStream.close(); } catch (_) {}
  }
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
