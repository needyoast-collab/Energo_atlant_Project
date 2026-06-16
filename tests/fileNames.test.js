const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getUploadFileExtension,
  normalizeStoredFileName,
  normalizeUploadFileName,
} = require('../utils/fileNames');

test('normalizeUploadFileName replaces path and filesystem separators', () => {
  assert.equal(
    normalizeUploadFileName('../unsafe/path:contract?.pdf'),
    '.._unsafe_path_contract_.pdf'
  );
});

test('normalizeUploadFileName returns fallback for empty names', () => {
  assert.equal(normalizeUploadFileName('   ', 'fallback.docx'), 'fallback.docx');
});

test('normalizeStoredFileName repairs common latin1 mojibake when it looks better', () => {
  assert.equal(normalizeStoredFileName('ÐÐ¾Ð³Ð¾Ð²Ð¾Ñ.pdf'), 'Договор.pdf');
});

test('getUploadFileExtension extracts normalized extension only', () => {
  assert.equal(getUploadFileExtension('contract.PDF'), 'pdf');
  assert.equal(getUploadFileExtension('archive.tar.gz'), 'gz');
  assert.equal(getUploadFileExtension('file.no?bad'), 'nobad');
});

test('getUploadFileExtension falls back when file has no extension', () => {
  assert.equal(getUploadFileExtension('contract'), 'bin');
  assert.equal(getUploadFileExtension('contract', 'dat'), 'dat');
});
