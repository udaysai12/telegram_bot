const fs = require('fs');
const path = require('path');
const { Api } = require('telegram');
const { NewMessage } = require('telegram/events');
const config = require('./config');
const { client, downloadTelegramFile, formatProgressBar } = require('./telegram');
const { uploadFile, makeFilePublic, getDirectDownloadLink } = require('./drive');


/**
 * Sanitizes a string to make it a safe filename.
 * Strips out newlines and keeps only the first line of multiline inputs.
 * Replaces illegal filename characters with underscores.
 */
function sanitizeFilename(name) {
  if (!name) return 'file';
  const lines = name.split(/\r?\n/);
  let firstLine = lines.find(line => line.trim().length > 0) || 'file';
  firstLine = firstLine.trim();

  let cleanName = firstLine.replace(/[\\/:*?"<>|]/g, '_');
  
  if (/^\.*$/.test(cleanName) || cleanName.length === 0) {
    cleanName = 'file';
  }
  
  return cleanName;
}

// Enforce downloads directory exists
const downloadsDir = path.resolve(__dirname, '../downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// In-memory queue
const uploadQueue = [];
let activeUploads = 0;

/**
 * Checks if a user is authorized based on config.adminIds.
 */
function isAuthorized(userId) {
  if (!userId) return false;
  if (config.adminIds.length === 0) {
    return false; // Strict private mode by default if not set
  }
  return config.adminIds.includes(userId);
}

/**
 * Extracts file metadata from a GramJS message.
 */
function getFileFromMessage(message) {
  if (!message || !message.media) {
    return null;
  }

  // Handle documents, videos, audios (all under MessageMediaDocument)
  if (message.media instanceof Api.MessageMediaDocument) {
    const doc = message.media.document;
    if (!doc) return null;

    const size = doc.size ? Number(doc.size.toString()) : 0;
    const mimeType = doc.mimeType || 'application/octet-stream';
    
    // Find the filename in attributes
    let fileName = `file_${doc.id.toString()}`;
    if (doc.attributes) {
      const filenameAttr = doc.attributes.find(
        (attr) => attr.className === 'DocumentAttributeFilename'
      );
      if (filenameAttr && filenameAttr.fileName) {
        fileName = sanitizeFilename(filenameAttr.fileName);
      }
    }
    
    return {
      media: message.media,
      fileName,
      fileSize: size,
      mimeType,
    };
  } 
  
  // Handle photos
  if (message.media instanceof Api.MessageMediaPhoto) {
    return {
      media: message.media,
      fileName: `photo_${Date.now()}.jpg`,
      fileSize: 0,
      mimeType: 'image/jpeg',
      isPhoto: true,
    };
  }

  return null;
}

/**
 * Helper to update a Telegram progress message safely using GramJS client.editMessage.
 */
async function updateProgressMessage(chatId, messageId, text) {
  try {
    await client.editMessage(chatId, {
      message: messageId,
      text: text,
      parseMode: 'markdown',
    });
  } catch (error) {
    if (
      !error.message.includes('message is not modified') && 
      !error.message.includes('Message to edit not found')
    ) {
      console.error('Failed to update progress message:', error.message);
    }
  }
}

/**
 * Processes the next item in the upload queue.
 */
async function processQueue() {
  if (uploadQueue.length === 0 || activeUploads >= config.maxConcurrentUploads) {
    return;
  }

  const task = uploadQueue.shift();
  activeUploads++;

  const localFilePath = path.join(downloadsDir, `${Date.now()}_${task.fileName}`);
  let isDownloaded = false;

  try {
    console.log(`[Queue] Processing file: ${task.fileName} (${task.fileSize} bytes)`);

    // 1. Download file from Telegram
    // Photos use downloadMedia (no document), Documents use downloadFile with explicit dcId
    await updateProgressMessage(
      task.chatId,
      task.progressMessageId,
      `📥 *Downloading from Telegram...*\n${formatProgressBar(0, task.fileSize)}`
    );

    if (task.isPhoto) {
      // Photos: use downloadMedia and write the buffer to disk
      const buffer = await client.downloadMedia(task.media, {});
      if (!buffer || buffer.length === 0) {
        throw new Error('Downloaded photo buffer is empty.');
      }
      fs.writeFileSync(localFilePath, buffer);
    } else {
      // Documents/Videos: stream download using explicit dcId
      await downloadTelegramFile(task.media, localFilePath, async (progress) => {
        await updateProgressMessage(
          task.chatId,
          task.progressMessageId,
          `📥 *Downloading from Telegram...*\n${formatProgressBar(progress.percentage, progress.totalBytes)}`
        );
      });
    }

    isDownloaded = true;
    console.log(`[Queue] Successfully downloaded local file: ${localFilePath}`);

    // Read local file size (useful if it was a photo with size 0 initially)
    const actualSize = fs.statSync(localFilePath).size;

    // 2. Upload file to Google Drive using resumable chunk upload
    await updateProgressMessage(
      task.chatId,
      task.progressMessageId,
      `📤 *Uploading to Google Drive...*\n${formatProgressBar(0, actualSize)}`
    );

    let lastUploadProgressUpdate = 0;
    const uploadUpdateIntervalMs = 3000;

    const driveFile = await uploadFile(
      localFilePath,
      task.fileName,
      task.mimeType,
      async (progress) => {
        const now = Date.now();
        if (now - lastUploadProgressUpdate > uploadUpdateIntervalMs || progress.percentage === '100.0') {
          lastUploadProgressUpdate = now;
          await updateProgressMessage(
            task.chatId,
            task.progressMessageId,
            `📤 *Uploading to Google Drive...*\n${formatProgressBar(progress.percentage, progress.totalBytes)}`
          );
        }
      }
    );

    console.log(`[Queue] Uploaded to Google Drive. File ID: ${driveFile.id}`);

    // 3. Make file public on Google Drive
    await updateProgressMessage(
      task.chatId,
      task.progressMessageId,
      `⚙️ *Configuring public permissions...*`
    );
    await makeFilePublic(driveFile.id);

    // 4. Send final download links
    const directLink = getDirectDownloadLink(driveFile.id);
    const sizeMB = (actualSize / (1024 * 1024)).toFixed(2);

    await client.sendMessage(task.chatId, {
      message: `✅ *Upload Successful!*\n\n` +
               `📄 *File Name:* \`${driveFile.name}\`\n` +
               `📦 *Size:* \`${sizeMB} MB\`\n\n` +
               `🔗 *Links:*\n` +
               `• [Open in Google Drive](${driveFile.webViewLink})\n` +
               `• [Direct Download](${directLink})`,
      parseMode: 'markdown',
    });

    // Remove the temporary progress message
    try {
      await client.deleteMessages(task.chatId, [task.progressMessageId], { revoke: true });
    } catch (_) {}

  } catch (error) {
    console.error(`[Queue] Failed to process ${task.fileName}:`, error);
    
    await client.sendMessage(task.chatId, {
      message: `❌ *Upload Failed!*\n\n` +
               `📄 *File:* \`${task.fileName}\`\n` +
               `⚠️ *Error:* \`${error.message}\``,
      parseMode: 'markdown',
    });

    try {
      await client.deleteMessages(task.chatId, [task.progressMessageId], { revoke: true });
    } catch (_) {}
  } finally {
    // 5. Clean up local files
    if (isDownloaded && fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
        console.log(`[Queue] Cleaned up temporary local file: ${localFilePath}`);
      } catch (err) {
        console.error(`[Queue] Failed to delete temporary file ${localFilePath}:`, err);
      }
    }

    activeUploads--;
    // Trigger next item in queue
    processQueue();
  }
}

/**
 * Entry point to initialize bot event listeners.
 */
function initBot() {
  console.log('Initializing GramJS Telegram listeners...');

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message) return;

    const text = message.message ? message.message.trim() : '';
    const userId = message.senderId ? Number(message.senderId.toString()) : null;
    const chatId = message.chatId ? message.chatId : null;

    if (!chatId) return;

    // Handle /start command
    if (text === '/start') {
      if (isAuthorized(userId)) {
        await client.sendMessage(chatId, {
          message: `👋 *Welcome to the Private Google Drive Uploader Bot!*\n\n` +
                   `Send me any file (document, video, audio, or photo) with an optional caption to name it, and I will upload it directly to Google Drive.`,
          parseMode: 'markdown',
        });
      } else {
        await client.sendMessage(chatId, {
          message: `🚫 *Access Denied*\n\n` +
                   `This is a private bot. Your Telegram User ID is: \`${userId}\`.\n\n` +
                   `To use this bot, add your ID to the \`ADMIN_IDS\` variable in your \`.env\` file and restart the bot.`,
          parseMode: 'markdown',
        });
      }
      return;
    }

    // Handle /status command
    if (text === '/status') {
      if (!isAuthorized(userId)) return;

      await client.sendMessage(chatId, {
        message: `📊 *Bot Status*\n\n` +
                 `• Active Uploads: \`${activeUploads}\`\n` +
                 `• Queued Files: \`${uploadQueue.length}\``,
        parseMode: 'markdown',
      });
      return;
    }

    // Ignore other commands
    if (text.startsWith('/')) {
      return;
    }

    // Authorize user for uploads
    if (!isAuthorized(userId)) {
      if (message.media) {
        await client.sendMessage(chatId, {
          message: `🚫 *Access Denied*\n\n` +
                   `Your Telegram User ID is \`${userId}\` but it is not authorized. Please add it to your \`ADMIN_IDS\` in \`.env\`.`,
          parseMode: 'markdown',
        });
      }
      return;
    }

    // Extract file info
    const fileData = getFileFromMessage(message);
    if (!fileData) {
      if (message.message) {
        await client.sendMessage(chatId, {
          message: `💡 Send me any file (as a Document, Video, or Photo) to upload it to Google Drive. You can add a caption to rename the file.`,
          parseMode: 'markdown',
        });
      }
      return;
    }

    // Determine file name: respect message text/caption for renaming
    let finalFileName = fileData.fileName;
    if (message.message && !message.message.startsWith('/')) {
      const caption = sanitizeFilename(message.message);
      const ext = path.extname(fileData.fileName);
      if (path.extname(caption) === '') {
        finalFileName = caption + ext;
      } else {
        finalFileName = caption;
      }
    }

    // Ensure the final filename is fully sanitized
    finalFileName = sanitizeFilename(finalFileName);

    // Send initial status message to user
    const placeholderMsg = await client.sendMessage(chatId, {
      message: `⏳ *Added to upload queue...*\nPosition in queue: \`${uploadQueue.length + 1}\``,
      parseMode: 'markdown',
    });

    // Push task onto queue
    uploadQueue.push({
      chatId,
      userId,
      media: fileData.media,
      fileName: finalFileName,
      fileSize: fileData.fileSize,
      mimeType: fileData.mimeType,
      isPhoto: fileData.isPhoto || false,
      progressMessageId: placeholderMsg.id,
    });

    // Start processing
    processQueue();
  }, new NewMessage({}));

  console.log('GramJS Telegram bot event listeners are active.');
}

module.exports = {
  initBot,
};
