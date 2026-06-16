const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MOBILE_TOKEN_SECRET = 'test-mobile-secret';

const {
  MOBILE_TOKEN_TTL_SECONDS,
  createMobileToken,
  verifyMobileToken,
} = require('../utils/mobileToken');

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

test('createMobileToken creates signed mobile token with expected payload', () => {
  const token = createMobileToken({ id: 42, role: 'foreman' });
  const payload = verifyMobileToken(token);

  assert.equal(typeof token, 'string');
  assert.equal(token.split('.').length, 3);
  assert.equal(payload.sub, 42);
  assert.equal(payload.role, 'foreman');
  assert.equal(payload.type, 'mobile');
  assert.equal(payload.exp - payload.iat, MOBILE_TOKEN_TTL_SECONDS);
});

test('verifyMobileToken rejects tampered signature', () => {
  const token = createMobileToken({ id: 42, role: 'foreman' });
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...decodePayload(token), role: 'admin' })).toString('base64url');

  assert.equal(verifyMobileToken(parts.join('.')), null);
});

test('verifyMobileToken rejects expired mobile token', (t) => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const token = createMobileToken({ id: 42, role: 'foreman' });

  Date.now.mock.mockImplementation(() => now + (MOBILE_TOKEN_TTL_SECONDS + 1) * 1000);

  assert.equal(verifyMobileToken(token), null);
});

test('verifyMobileToken rejects malformed tokens', () => {
  assert.equal(verifyMobileToken(''), null);
  assert.equal(verifyMobileToken('one.two'), null);
  assert.equal(verifyMobileToken('one.two.three.four'), null);
});
