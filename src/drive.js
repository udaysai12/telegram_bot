const { google } = require('googleapis');
const fs = require('fs');
const config = require('./config');

let driveInstance = null;

/**
 * Initialize and get the Google Drive API client.
 */
function getDriveClient() {
  if (driveInstance) return driveInstance;

  if (!config.credentialsPath) {
    throw new Error('Google Application Credentials path is not configured.');
  }

  // Set up service account authentication
  const auth = new google.auth.GoogleAuth({
    keyFile: config.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

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
