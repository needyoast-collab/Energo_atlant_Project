const test = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../config/database');
const { ROLES } = require('../utils/constants');
const {
  addWorkSpec,
  createStage,
  generateStagesFromVOR,
  updateStage,
} = require('../controllers/managerController');
const { createNext, createReq, createRes } = require('./helpers/http');

function createClientMock(handler) {
  const calls = [];
  return {
    calls,
    released: false,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params, calls);
    },
    release() {
      this.released = true;
    },
  };
}

async function callController(controller, {
  params = {},
  body = {},
  userId = 10,
  userRole = ROLES.MANAGER,
} = {}) {
  const req = createReq({
    params,
    body,
    session: { userId, userRole },
  });
  const res = createRes();
  const next = createNext();

  await controller(req, res, next);

  return { req, res, next };
}

function isManagerProjectAccessQuery(sql) {
  return sql.includes('FROM projects p') && sql.includes('WHERE p.id = $1');
}

test('manager createStage is rejected before writing project_stages', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(createStage, {
    params: { id: 1 },
    body: {
      name: 'Монтаж кабеля',
      order_num: 1,
    },
    userRole: ROLES.MANAGER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Изменять этапы может только администратор или прораб');
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO project_stages')), false);
});

test('admin createStage creates stage and writes project history', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    if (sql.includes('INSERT INTO project_stages')) {
      return {
        rows: [{
          id: 7,
          name: 'Монтаж кабеля',
          status: 'pending',
          order_num: 1,
          planned_start: new Date('2026-05-10T00:00:00.000Z'),
          planned_end: new Date('2026-05-12T00:00:00.000Z'),
          planned_value: null,
          unit: null,
          actual_value: 0,
        }],
      };
    }
    if (sql.includes('INSERT INTO project_history')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(createStage, {
    params: { id: 1 },
    body: {
      name: 'Монтаж кабеля',
      order_num: 1,
      planned_start: '2026-05-10',
      planned_end: '2026-05-12',
    },
    userId: 1,
    userRole: ROLES.ADMIN,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.planned_start, '2026-05-10');
  assert.equal(res.body.data.planned_end, '2026-05-12');
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO project_history')), true);
});

test('manager updateStage is rejected after read/access check and before update', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM project_stages WHERE id = $1')) {
      return {
        rows: [{
          project_id: 1,
          name: 'Этап',
          status: 'pending',
          order_num: 1,
          planned_start: null,
          planned_end: null,
          actual_end: null,
          is_from_vor: false,
          planned_value: null,
          actual_value: null,
          planned_date: null,
          actual_date: null,
          note: null,
        }],
      };
    }
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(updateStage, {
    params: { stageId: 7 },
    body: { status: 'in_progress' },
    userRole: ROLES.MANAGER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.some((call) => call.sql.includes('UPDATE project_stages SET')), false);
});

test('manager can add work spec and pending catalog item is created when price is provided', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    if (sql.includes('INSERT INTO work_specs')) {
      return {
        rows: [{
          id: 11,
          work_name: 'Прокладка КЛ',
          unit: 'м',
          quantity: 100,
          manager_price: 1200,
          created_at: '2026-05-20T00:00:00.000Z',
        }],
      };
    }
    if (sql.includes('INSERT INTO project_history')) return { rows: [] };
    if (sql.includes('FROM price_catalog')) return { rows: [] };
    if (sql.includes('INSERT INTO price_catalog')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(addWorkSpec, {
    params: { id: 1 },
    body: {
      work_name: 'Прокладка КЛ',
      unit: 'м',
      quantity: 100,
      manager_price: 1200,
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.work_name, 'Прокладка КЛ');
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO price_catalog')), true);
});

test('manager generateStagesFromVOR is rejected before reading project state', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { res, next } = await callController(generateStagesFromVOR, {
    params: { id: 1 },
    userRole: ROLES.MANAGER,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.some((call) => call.sql.includes('SELECT stages_generated')), false);
});

test('admin generateStagesFromVOR inserts stages and marks project generated transactionally', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO project_stages')) return { rows: [] };
    if (sql.includes('UPDATE projects SET stages_generated = true')) return { rows: [] };
    throw new Error(`Unexpected client query: ${sql}`);
  });
  const calls = [];

  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (isManagerProjectAccessQuery(sql)) return { rows: [{ id: 1, manager_id: 10 }] };
    if (sql.includes('SELECT stages_generated, kp_sent_at')) {
      return { rows: [{ stages_generated: false, kp_sent_at: '2026-05-20' }] };
    }
    if (sql.includes('FROM work_specs')) {
      return {
        rows: [
          { id: 21, work_name: 'Прокладка КЛ', unit: 'м', quantity: 100 },
          { id: 22, work_name: 'Монтаж щита', unit: 'шт', quantity: 1 },
        ],
      };
    }
    if (sql.includes('FROM project_stages') && sql.includes('ORDER BY order_num')) {
      return {
        rows: [
          { id: 31, name: 'Прокладка КЛ', status: 'planned', order_num: 1 },
          { id: 32, name: 'Монтаж щита', status: 'planned', order_num: 2 },
        ],
      };
    }
    if (sql.includes('INSERT INTO project_history')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(generateStagesFromVOR, {
    params: { id: 1 },
    userId: 1,
    userRole: ROLES.ADMIN,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.length, 2);
  assert.equal(client.calls.filter((call) => call.sql.includes('INSERT INTO project_stages')).length, 2);
  assert.equal(client.calls.some((call) => call.sql.includes('UPDATE projects SET stages_generated = true')), true);
  assert.deepEqual(client.calls.map((call) => call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : call.sql.match(/^(INSERT|UPDATE)/)?.[1]), [
    'BEGIN',
    'INSERT',
    'INSERT',
    'UPDATE',
    'COMMIT',
  ]);
  assert.equal(client.released, true);
});
