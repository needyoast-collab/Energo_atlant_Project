const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');

function ensureStorageAvailable() {
  if (s3 && BUCKET) return;

  const err = new Error('Хранилище файлов недоступно');
  err.status = 503;
  throw err;
}

async function deleteStoredObject(fileKey) {
  ensureStorageAvailable();
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
}

module.exports = {
  deleteStoredObject,
  ensureStorageAvailable,
};
