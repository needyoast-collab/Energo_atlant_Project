process.env.MOBILE_TOKEN_SECRET = 'test-mobile-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../config/database');
const { ROLES, isAuthenticated, requireRole } = require('../middleware/auth');
const { createMobileToken } = require('../utils/mobileToken');
const { createNext, createRes } = require('./helpers/http');

function createAuthReq({ session = {}, authorization = '' } = {}) {
  return {
    session,
    mobileAuth: false,
    get(name) {
      return name.toLowerCase() === 'authorization' ? authorization : '';
    },
  };
}

async function callMiddleware(handler, req) {
  const res = createRes();
  const next = createNext();

  await handler(req, res, next);

  return { res, next };
}

test('isAuthenticated accepts existing web session without DB lookup', async (t) => {
  const req = createAuthReq({
    session: { userId: 10, userRole: ROLES.MANAGER },
  });
  const queryMock = t.mock.method(pool, 'query', async () => {
    throw new Error('DB should not be queried for an existing session');
  });

  const { res, next } = await callMiddleware(isAuthenticated, req);

  assert.equal(next.error, null);
  assert.equal(res.body, null);
  assert.equal(queryMock.mock.callCount(), 0);
});

test('isAuthenticated rejects missing session and missing bearer token', async () => {
  const req = createAuthReq();

  const { res, next } = await callMiddleware(isAuthenticated, req);

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { success: false, error: 'Не авторизован' });
});

test('isAuthenticated attaches valid mobile bearer token to session', async (t) => {
  const token = createMobileToken({ id: 55, role: ROLES.FOREMAN });
  const req = createAuthReq({
    session: {},
    authorization: `Bearer ${token}`,
  });

  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /WHERE id = \$1/);
    assert.deepEqual(params, [55]);
    return { rows: [{ id: 55, role: ROLES.FOREMAN }] };
  });

  const { res, next } = await callMiddleware(isAuthenticated, req);

  assert.equal(next.error, null);
  assert.equal(res.body, null);
  assert.equal(req.mobileAuth, true);
  assert.equal(req.session.userId, 55);
  assert.equal(req.session.userRole, ROLES.FOREMAN);
});

test('isAuthenticated rejects invalid mobile bearer token without DB lookup', async (t) => {
  const req = createAuthReq({
    session: {},
    authorization: 'Bearer invalid.token.value',
  });
  const queryMock = t.mock.method(pool, 'query', async () => {
    throw new Error('DB should not be queried for invalid token');
  });

  const { res, next } = await callMiddleware(isAuthenticated, req);

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 401);
  assert.equal(queryMock.mock.callCount(), 0);
});

test('isAuthenticated rejects mobile token when user is not verified or deleted', async (t) => {
  const token = createMobileToken({ id: 55, role: ROLES.FOREMAN });
  const req = createAuthReq({
    session: {},
    authorization: `Bearer ${token}`,
  });

  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const { res, next } = await callMiddleware(isAuthenticated, req);

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.userId, undefined);
});

test('requireRole accepts allowed role and rejects forbidden role', async () => {
  const allowedReq = createAuthReq({
    session: { userId: 1, userRole: ROLES.MANAGER },
  });
  const forbiddenReq = createAuthReq({
    session: { userId: 2, userRole: ROLES.FOREMAN },
  });
  const handler = requireRole([ROLES.MANAGER, ROLES.ADMIN]);

  const allowed = await callMiddleware(handler, allowedReq);
  const forbidden = await callMiddleware(handler, forbiddenReq);

  assert.equal(allowed.next.error, null);
  assert.equal(allowed.res.body, null);
  assert.equal(forbidden.next.error, null);
  assert.equal(forbidden.res.statusCode, 403);
  assert.deepEqual(forbidden.res.body, { success: false, error: 'Доступ запрещён' });
});

test('requireRole accepts role passed as a single value', async () => {
  const req = createAuthReq({
    session: { userId: 3, userRole: ROLES.PARTNER },
  });
  const handler = requireRole(ROLES.PARTNER);

  const { res, next } = await callMiddleware(handler, req);

  assert.equal(next.error, null);
  assert.equal(res.body, null);
});
