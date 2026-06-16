process.env.YOS_BUCKET = process.env.YOS_BUCKET || 'test-bucket';
process.env.YOS_ENDPOINT = process.env.YOS_ENDPOINT || 'https://storage.yandexcloud.net';
process.env.YOS_ACCESS_KEY = process.env.YOS_ACCESS_KEY || 'test-access-key';
process.env.YOS_SECRET_KEY = process.env.YOS_SECRET_KEY || 'test-secret-key';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../config/database');
const { ROLES } = require('../utils/constants');
const { getDocuments: getCustomerDocuments } = require('../controllers/customerController');
const { getDocuments: getPtoDocuments } = require('../controllers/ptoController');
const { getDocuments: getManagerDocuments } = require('../controllers/managerDocumentController');
const { createNext, createReq, createRes } = require('./helpers/http');

function createDocumentRows() {
  return [
    {
      id: 1,
      doc_type: 'contract',
      file_key: 'documents/1/manager/contract/file.pdf',
      file_name: 'contract.pdf',
      description: null,
      uploaded_at: '2026-05-20T00:00:00.000Z',
      uploaded_by_name: 'Менеджер',
      uploaded_by_id: 10,
    },
    {
      id: 2,
      doc_type: 'rd',
      file_key: 'documents/1/rd/file.pdf',
      file_name: 'rd.pdf',
      description: null,
      uploaded_at: '2026-05-20T00:00:00.000Z',
      uploaded_by_name: 'ПТО',
      uploaded_by_id: 20,
    },
  ];
}

async function callController(controller, { projectId = 1, userId = 10, userRole }) {
  const req = createReq({
    params: { id: projectId },
    session: { userId, userRole },
  });
  const res = createRes();
  const next = createNext();

  await controller(req, res, next);

  return { req, res, next };
}

test('customer document list requests financial and technical document types', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users u')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM project_documents')) return { rows: createDocumentRows() };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getCustomerDocuments, {
    userRole: ROLES.CUSTOMER,
  });

  const docTypeParam = calls[1].params[1];
  assert.equal(next.error, null);
  assert.equal(res.body.success, true);
  assert.equal(docTypeParam.includes('contract'), true);
  assert.equal(docTypeParam.includes('rd'), true);
  assert.equal(res.body.data[0].is_financial, true);
  assert.match(res.body.data[0].url, /^\/api\/documents\/serve\//);
});

test('pto document list excludes financial document types', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users u')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM project_documents')) return {
      rows: createDocumentRows().filter((doc) => params[1].includes(doc.doc_type)),
    };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getPtoDocuments, {
    userRole: ROLES.PTO,
  });

  const docTypeParam = calls[1].params[1];
  assert.equal(next.error, null);
  assert.equal(docTypeParam.includes('contract'), false);
  assert.equal(docTypeParam.includes('estimate'), false);
  assert.equal(docTypeParam.includes('rd'), true);
  assert.deepEqual(res.body.data.map((doc) => doc.doc_type), ['rd']);
});

test('project document list returns 403 before document query when user is not project member', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM users u')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getPtoDocuments, {
    userRole: ROLES.PTO,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(calls.length, 1);
});

test('manager document list includes financial documents and protected URLs', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM projects p')) return { rows: [{ id: 1, manager_id: 10 }] };
    if (sql.includes('FROM project_documents')) return { rows: createDocumentRows() };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getManagerDocuments, {
    userId: 10,
    userRole: ROLES.MANAGER,
  });

  const docTypeParam = calls[1].params[1];
  assert.equal(next.error, null);
  assert.equal(res.body.success, true);
  assert.equal(docTypeParam.includes('contract'), true);
  assert.equal(docTypeParam.includes('rd'), true);
  assert.equal(res.body.data.every((doc) => doc.url.startsWith('/api/documents/serve/')), true);
});
