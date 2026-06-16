process.env.YOS_BUCKET = process.env.YOS_BUCKET || 'test-bucket';
process.env.YOS_ENDPOINT = process.env.YOS_ENDPOINT || 'https://storage.yandexcloud.net';
process.env.YOS_ACCESS_KEY = process.env.YOS_ACCESS_KEY || 'test-access-key';
process.env.YOS_SECRET_KEY = process.env.YOS_SECRET_KEY || 'test-secret-key';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../config/database');
const { ROLES } = require('../utils/constants');
const { encodeFileKey } = require('../utils/signedUrl');
const { serveDocument } = require('../controllers/documentController');
const { createNext, createReq, createRes } = require('./helpers/http');

function mockDocumentAccess(t, {
  photoRows = [],
  documentRows = [],
  requestFileRows = [],
} = {}) {
  const calls = [];

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });

    if (sql.includes('FROM stage_photos')) {
      return { rows: photoRows };
    }
    if (sql.includes('FROM project_documents')) {
      return { rows: documentRows };
    }
    if (sql.includes('FROM public_request_files')) {
      return { rows: requestFileRows };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return calls;
}

async function callServeDocument({ fileKey, userId = 10, userRole, access }) {
  const req = createReq({
    params: { key: encodeFileKey(fileKey) },
    session: { userId, userRole },
  });
  const res = createRes();
  const next = createNext();

  await serveDocument(req, res, next);

  return { req, res, next, calls: access };
}

test('serveDocument denies financial project document to production member roles', async (t) => {
  const fileKey = 'documents/1/manager/contract/file.pdf';
  const calls = mockDocumentAccess(t, {
    documentRows: [{
      id: 1,
      doc_type: 'contract',
      manager_id: 99,
      is_project_member: true,
    }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userRole: ROLES.FOREMAN,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { success: false, error: 'Нет доступа к файлу' });
  assert.equal(calls[1].params[0], fileKey);
});

test('serveDocument redirects customer project member to financial document signed URL', async (t) => {
  const fileKey = 'documents/1/manager/contract/file.pdf';
  const calls = mockDocumentAccess(t, {
    documentRows: [{
      id: 1,
      doc_type: 'contract',
      manager_id: 99,
      is_project_member: true,
    }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userRole: ROLES.CUSTOMER,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.redirectStatus, 302);
  assert.match(res.redirectUrl, /^https:\/\/storage\.yandexcloud\.net\//);
  assert.match(res.redirectUrl, /X-Amz-Signature=/);
  assert.equal(calls.length, 3);
});

test('serveDocument allows manager of project to access project document without membership row', async (t) => {
  const fileKey = 'documents/1/manager/estimate/file.pdf';
  const calls = mockDocumentAccess(t, {
    documentRows: [{
      id: 2,
      doc_type: 'estimate',
      manager_id: 10,
      is_project_member: false,
    }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userId: 10,
    userRole: ROLES.MANAGER,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.redirectStatus, 302);
  assert.match(res.redirectUrl, /X-Amz-Signature=/);
});

test('serveDocument allows admin to access stage photo without project membership', async (t) => {
  const fileKey = 'stage_photos/7/photo.png';
  const calls = mockDocumentAccess(t, {
    photoRows: [{
      stage_id: 7,
      is_project_member: false,
    }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userRole: ROLES.ADMIN,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.redirectStatus, 302);
  assert.match(res.redirectUrl, /X-Amz-Signature=/);
});

test('serveDocument denies stage photo to non-member production user', async (t) => {
  const fileKey = 'stage_photos/7/photo.png';
  const calls = mockDocumentAccess(t, {
    photoRows: [{
      stage_id: 7,
      is_project_member: false,
    }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userRole: ROLES.SUPPLIER,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test('serveDocument allows public request file only to manager or admin', async (t) => {
  const fileKey = 'public_requests/3/request.pdf';
  const calls = mockDocumentAccess(t, {
    requestFileRows: [{ id: 3 }],
  });

  const managerResult = await callServeDocument({
    fileKey,
    userRole: ROLES.MANAGER,
    access: calls,
  });

  assert.equal(managerResult.next.error, null);
  assert.equal(managerResult.res.redirectStatus, 302);
  assert.match(managerResult.res.redirectUrl, /X-Amz-Signature=/);
});

test('serveDocument denies public request file to non-manager production role', async (t) => {
  const fileKey = 'public_requests/3/request.pdf';
  const calls = mockDocumentAccess(t, {
    requestFileRows: [{ id: 3 }],
  });

  const { res, next } = await callServeDocument({
    fileKey,
    userRole: ROLES.CUSTOMER,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { success: false, error: 'Нет доступа к файлу' });
});

test('serveDocument denies unknown file key', async (t) => {
  const calls = mockDocumentAccess(t);

  const { res, next } = await callServeDocument({
    fileKey: 'missing/file.pdf',
    userRole: ROLES.ADMIN,
    access: calls,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { success: false, error: 'Нет доступа к файлу' });
});
