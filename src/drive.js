const { google } = require('googleapis');
const fs = require('fs');
const config = require('./config');

let driveInstance = null;

/**
 * Initialize and get the Google Drive API client.
 */
function getDriveClient() {
  if (driveInstance) return driveInstance;

  let auth;

  // 1. Try reading credentials from a JSON string in environment variable (Render / Cloud deployment)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      console.log('[Drive] Initialized authentication using GOOGLE_CREDENTIALS_JSON environment variable.');
    } catch (err) {
      throw new Error(`Failed to parse GOOGLE_CREDENTIALS_JSON: ${err.message}`);
    }
  } 
  // 2. Try reading credentials from the file path
  else if (config.credentialsPath && fs.existsSync(config.credentialsPath)) {
    auth = new google.auth.GoogleAuth({
      keyFile: config.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    console.log(`[Drive] Initialized authentication using credentials file: ${config.credentialsPath}`);
  } 
  // 3. Fail if neither is found
  else {
    throw new Error('Google Drive credentials not found! Set GOOGLE_CREDENTIALS_JSON or provide credentials.json file.');
  }

  driveInstance = google.drive({ version: 'v3', auth });
  return driveInstance;
}

/**
 * Uploads a local file to Google Drive using a resumable upload session.
 * 
 * @param {string} filePath - Path to the local file.
 * @param {string} fileName - Destination file name in Google Drive.
 * @param {string} mimeType - The file's MIME type.
 * @param {function} onProgress - Progress callback function.
 * @returns {Promise<object>} The uploaded file metadata.
 */
async function uploadFile(filePath, fileName, mimeType, onProgress) {
  const drive = getDriveClient();
  const fileSize = fs.statSync(filePath).size;
  
  const fileMetadata = {
    name: fileName,
  };
  
  // Set parent folder if configured
  if (config.driveFolderId) {
    fileMetadata.parents = [config.driveFolderId];
  }

  const media = {
    mimeType: mimeType || 'application/octet-stream',
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create(
    {
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, mimeType, webViewLink, webContentLink',
    },
    {
      uploadType: 'resumable',
      onUploadProgress: (event) => {
        if (onProgress && typeof onProgress === 'function') {
          const bytesRead = event.bytesRead;
          onProgress({
            bytesUploaded: bytesRead,
            totalBytes: fileSize,
            percentage: ((bytesRead / fileSize) * 100).toFixed(1),
          });
        }
      },
    }
  );

  return response.data;
}

/**
 * Sets file permission to 'anyone' with role 'reader' (makes it public).
 * 
 * @param {string} fileId - The Google Drive file ID.
 */
async function makeFilePublic(fileId) {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });
}

/**
 * Generates a direct download link for a file.
 * Note: Large files may prompt a virus warning screen for users.
 * 
 * @param {string} fileId - Google Drive file ID.
 * @returns {string} Direct download link.
 */
function getDirectDownloadLink(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

module.exports = {
  uploadFile,
  makeFilePublic,
  getDirectDownloadLink,
};
