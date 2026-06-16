const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CUSTOMER_REQUEST_FILE_MIME_TYPES,
  FOREMAN_PHOTO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MB,
  PROJECT_DOCUMENT_MIME_TYPES,
} = require('../utils/upload');

test('upload constants define 1MB in bytes', () => {
  assert.equal(MB, 1024 * 1024);
});

test('project document uploads allow pdf, office documents and safe image formats', () => {
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('application/pdf'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('application/msword'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('image/jpeg'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('image/png'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('image/webp'), true);
});

test('foreman photo uploads allow HEIC but project documents do not', () => {
  assert.equal(FOREMAN_PHOTO_MIME_TYPES.includes('image/heic'), true);
  assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes('image/heic'), false);
});

test('customer request files allow DWG variants while image constants stay narrow', () => {
  assert.equal(CUSTOMER_REQUEST_FILE_MIME_TYPES.includes('application/x-dwg'), true);
  assert.equal(CUSTOMER_REQUEST_FILE_MIME_TYPES.includes('image/vnd.dwg'), true);
  assert.deepEqual(IMAGE_MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
});

test('upload MIME allowlists reject executable/script MIME types', () => {
  const disallowed = ['application/javascript', 'text/html', 'application/x-msdownload'];

  disallowed.forEach((mimeType) => {
    assert.equal(PROJECT_DOCUMENT_MIME_TYPES.includes(mimeType), false);
    assert.equal(CUSTOMER_REQUEST_FILE_MIME_TYPES.includes(mimeType), false);
    assert.equal(FOREMAN_PHOTO_MIME_TYPES.includes(mimeType), false);
  });
});
