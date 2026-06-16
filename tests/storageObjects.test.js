const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.YOS_BUCKET;
delete process.env.YOS_ENDPOINT;
delete process.env.YOS_ACCESS_KEY;
delete process.env.YOS_SECRET_KEY;

const originalWarn = console.warn;
console.warn = () => {};
const {
  deleteStoredObject,
  ensureStorageAvailable,
} = require('../utils/storageObjects');
console.warn = originalWarn;

test('ensureStorageAvailable reports unavailable YOS as service error', () => {
  assert.throws(
    () => ensureStorageAvailable(),
    (err) => err.message === 'Хранилище файлов недоступно' && err.status === 503
  );
});

test('deleteStoredObject fails before trying to delete when storage is not configured', async () => {
  await assert.rejects(
    () => deleteStoredObject('documents/1/file.pdf'),
    (err) => err.message === 'Хранилище файлов недоступно' && err.status === 503
  );
});
