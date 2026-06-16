const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');

async function getSignedDownloadUrl(fileKey) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: fileKey });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // TTL 1 час
}

function encodeFileKey(fileKey) {
  return Buffer.from(String(fileKey), 'utf8').toString('base64url');
}

function getProtectedDownloadUrl(fileKey) {
  return `/api/documents/serve/${encodeFileKey(fileKey)}`;
}

module.exports = {
  encodeFileKey,
  getProtectedDownloadUrl,
  getSignedDownloadUrl,
};
