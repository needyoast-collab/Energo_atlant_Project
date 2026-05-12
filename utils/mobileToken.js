const crypto = require('crypto');

const MOBILE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function getMobileTokenSecret() {
  const secret = process.env.MOBILE_TOKEN_SECRET || process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error('MOBILE_TOKEN_SECRET or SESSION_SECRET is required');
  }

  return secret;
}

function sign(input) {
  return crypto
    .createHmac('sha256', getMobileTokenSecret())
    .update(input)
    .digest('base64url');
}

function createMobileToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const payload = {
    sub: user.id,
    role: user.role,
    type: 'mobile',
    iat: now,
    exp: now + MOBILE_TOKEN_TTL_SECONDS,
  };

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

function verifyMobileToken(token) {
  let header;
  let payload;
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(unsignedToken);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    header = base64UrlDecode(encodedHeader);
    payload = base64UrlDecode(encodedPayload);
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  if (payload.type !== 'mobile' || !payload.sub || !payload.exp || payload.exp <= now) {
    return null;
  }

  return payload;
}

module.exports = {
  MOBILE_TOKEN_TTL_SECONDS,
  createMobileToken,
  verifyMobileToken,
};
