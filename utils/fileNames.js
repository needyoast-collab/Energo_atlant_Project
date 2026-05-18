const MOJIBAKE_MARKS = /[ÐÑÂÃ�]/;
const CYRILLIC = /[А-Яа-яЁё]/;
const FORBIDDEN_FILE_CHARS = /[/\\?%*:|"<>]/g;

function getMojibakeScore(value) {
  return (String(value || '').match(/[ÐÑÂÃ�]/g) || []).length;
}

function repairMojibake(value) {
  const text = String(value || '');
  if (!MOJIBAKE_MARKS.test(text) || CYRILLIC.test(text)) return text;

  const decoded = Buffer.from(text, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('�')) return text;

  const decodedLooksBetter = CYRILLIC.test(decoded) || getMojibakeScore(decoded) < getMojibakeScore(text);
  return decodedLooksBetter ? decoded : text;
}

function normalizeStoredFileName(value) {
  return repairMojibake(value);
}

function normalizeUploadFileName(value, fallback = 'file') {
  const repaired = normalizeStoredFileName(value).trim() || fallback;
  return repaired.replace(FORBIDDEN_FILE_CHARS, '_');
}

function getUploadFileExtension(value, fallback = 'bin') {
  const name = normalizeUploadFileName(value, fallback);
  const ext = name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || fallback;
}

module.exports = {
  getUploadFileExtension,
  normalizeStoredFileName,
  normalizeUploadFileName,
};
