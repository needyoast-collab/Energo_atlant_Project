process.env.YOS_BUCKET = process.env.YOS_BUCKET || 'test-bucket';
process.env.YOS_ENDPOINT = process.env.YOS_ENDPOINT || 'https://storage.yandexcloud.net';
process.env.YOS_ACCESS_KEY = process.env.YOS_ACCESS_KEY || 'test-access-key';
process.env.YOS_SECRET_KEY = process.env.YOS_SECRET_KEY || 'test-secret-key';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../config/database');
const { ROLES } = require('../utils/constants');
const {
  getProject: getManagerProject,
} = require('../controllers/managerController');
const {
  getProject: getForemanProject,
} = require('../controllers/foremanController');
const {
  getProjects: getCustomerProjects,
  getStages: getCustomerStages,
} = require('../controllers/customerController');
const {
  getWarehouse: getSupplierWarehouse,
} = require('../controllers/supplierController');
const {
  getProjects: getPtoProjects,
} = require('../controllers/ptoController');
const { createNext, createReq, createRes } = require('./helpers/http');

function isMembershipQuery(sql) {
  return sql.includes('FROM users u') && sql.includes('EXISTS');
}

async function callController(controller, {
  params = {},
  userId = 10,
  userRole,
} = {}) {
  const req = createReq({
    params,
    session: { userId, userRole },
  });
  const res = createRes();
  const next = createNext();

  await controller(req, res, next);

  return { req, res, next };
}

test('manager getProject scopes lookup by current manager id', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM projects p') && sql.includes('WHERE p.id = $1')) {
      assert.match(sql, /p\.manager_id = \$2/);
      assert.deepEqual(params, [1, 10]);
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getManagerProject, {
    params: { id: 1 },
    userRole: ROLES.MANAGER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Проект не найден');
  assert.equal(calls.length, 1);
});

test('admin getProject bypasses manager ownership filter and loads team', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM projects p') && sql.includes('WHERE p.id = $1')) {
      assert.equal(sql.includes('p.manager_id = $2'), false);
      assert.deepEqual(params, [1]);
      return {
        rows: [{
          id: 1,
          code: 'PRJ-2026-0001',
          name: 'Объект',
          status: 'work',
          contract_signed_at: new Date('2026-05-10T00:00:00.000Z'),
          planned_start: null,
          planned_end: null,
          kp_sent_at: null,
        }],
      };
    }
    if (sql.includes('FROM project_members pm')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(getManagerProject, {
    params: { id: 1 },
    userId: 1,
    userRole: ROLES.ADMIN,
  });

  assert.equal(next.error, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.contract_signed_at, '2026-05-10');
  assert.deepEqual(res.body.data.team, []);
  assert.equal(calls.length, 2);
});

test('foreman getProject returns 403 and skips project query when not a member', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isMembershipQuery(sql)) return { rows: [] };
    throw new Error(`Unexpected query after denied membership: ${sql}`);
  });

  const { res, next } = await callController(getForemanProject, {
    params: { id: 1 },
    userRole: ROLES.FOREMAN,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Нет доступа к проекту');
  assert.equal(calls.length, 1);
});

test('customer getStages returns 403 and skips stages query when not a member', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isMembershipQuery(sql)) return { rows: [] };
    throw new Error(`Unexpected query after denied membership: ${sql}`);
  });

  const { res, next } = await callController(getCustomerStages, {
    params: { id: 1 },
    userRole: ROLES.CUSTOMER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Нет доступа к проекту');
  assert.equal(calls.length, 1);
});

test('supplier getWarehouse returns 403 and skips warehouse query when not a member', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isMembershipQuery(sql)) return { rows: [] };
    throw new Error(`Unexpected query after denied membership: ${sql}`);
  });

  const { res, next } = await callController(getSupplierWarehouse, {
    params: { id: 1 },
    userRole: ROLES.SUPPLIER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Нет доступа к проекту');
  assert.equal(calls.length, 1);
});

test('customer project list is scoped by current user and customer role', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /JOIN project_members pm ON pm\.project_id = p\.id/);
    assert.match(sql, /pm\.user_id = \$1 AND pm\.role = \$2/);
    assert.deepEqual(params, [10, ROLES.CUSTOMER]);
    return { rows: [] };
  });

  const { res, next } = await callController(getCustomerProjects, {
    userRole: ROLES.CUSTOMER,
  });

  assert.equal(next.error, null);
  assert.deepEqual(res.body, { success: true, data: [] });
});

test('pto project list is scoped by current user and pto role', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.match(sql, /JOIN project_members pm ON pm\.project_id = p\.id/);
    assert.match(sql, /pm\.user_id = \$1 AND pm\.role = \$2/);
    assert.deepEqual(params, [10, ROLES.PTO]);
    return { rows: [] };
  });

  const { res, next } = await callController(getPtoProjects, {
    userRole: ROLES.PTO,
  });

  assert.equal(next.error, null);
  assert.deepEqual(res.body, { success: true, data: [] });
});

test('admin pto project list is not scoped to project_members', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.equal(sql.includes('JOIN project_members pm'), false);
    assert.deepEqual(params, []);
    return { rows: [] };
  });

  const { res, next } = await callController(getPtoProjects, {
    userId: 1,
    userRole: ROLES.ADMIN,
  });

  assert.equal(next.error, null);
  assert.deepEqual(res.body, { success: true, data: [] });
});
