const test = require('node:test');
const assert = require('node:assert/strict');

process.env.YOS_BUCKET = process.env.YOS_BUCKET || 'test-bucket';
process.env.YOS_ENDPOINT = process.env.YOS_ENDPOINT || 'https://storage.yandexcloud.net';
process.env.YOS_ACCESS_KEY = process.env.YOS_ACCESS_KEY || 'test-access-key';
process.env.YOS_SECRET_KEY = process.env.YOS_SECRET_KEY || 'test-secret-key';

const {
  encodeFileKey,
  getProtectedDownloadUrl,
} = require('../utils/signedUrl');

test('encodeFileKey produces base64url value that round-trips unicode file keys', () => {
  const fileKey = 'projects/42/акты/КС-2 №1.pdf';
  const encoded = encodeFileKey(fileKey);

  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), fileKey);
});

test('getProtectedDownloadUrl hides raw storage key from public URL path', () => {
  const fileKey = 'stage_photos/7/photo 1.png';
  const url = getProtectedDownloadUrl(fileKey);

  assert.match(url, /^\/api\/documents\/serve\/[A-Za-z0-9_-]+$/);
  assert.equal(url.includes(fileKey), false);
});
