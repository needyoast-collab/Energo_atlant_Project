const test = require('node:test');
const assert = require('node:assert/strict');

process.env.YOS_BUCKET = process.env.YOS_BUCKET || 'test-bucket';
process.env.YOS_ENDPOINT = process.env.YOS_ENDPOINT || 'https://storage.yandexcloud.net';
process.env.YOS_ACCESS_KEY = process.env.YOS_ACCESS_KEY || 'test-access-key';
process.env.YOS_SECRET_KEY = process.env.YOS_SECRET_KEY || 'test-secret-key';

const { pool } = require('../config/database');
const { ROLES } = require('../utils/constants');
const { transferToProject, fulfillSpec } = require('../controllers/supplierController');
const { writeoffWarehouse } = require('../controllers/foremanController');
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

function isMembershipQuery(sql) {
  return sql.includes('FROM users u');
}

async function callController(controller, {
  params = {},
  body = {},
  userId = 10,
  userRole = ROLES.SUPPLIER,
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

test('supplier transferToProject moves material atomically from general warehouse to project warehouse', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM warehouse_general')) {
      return {
        rows: [{
          id: 5,
          material_name: 'Кабель ВВГнг',
          unit: 'м',
          qty_total: '100',
          qty_reserved: '20',
        }],
      };
    }
    if (sql.includes('UPDATE warehouse_general')) return { rows: [] };
    if (sql.includes('INSERT INTO warehouse_project')) {
      return {
        rows: [{
          id: 9,
          material_name: 'Кабель ВВГнг',
          unit: 'м',
          qty_total: '30',
          qty_used: '0',
          source: 'company',
        }],
      };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (isMembershipQuery(sql)) return { rows: [{ '?column?': 1 }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(transferToProject, {
    params: { id: 5 },
    body: {
      project_id: 1,
      quantity: 30,
      notes: 'На объект',
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.source, 'company');
  assert.deepEqual(client.calls.map((call) => call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : call.sql.match(/^(SELECT|UPDATE|INSERT)/)?.[1]), [
    'BEGIN',
    'SELECT',
    'UPDATE',
    'INSERT',
    'COMMIT',
  ]);
  assert.deepEqual(client.calls.find((call) => call.sql.includes('UPDATE warehouse_general')).params, [30, 5]);
  assert.equal(client.released, true);
});

test('supplier transferToProject rolls back when project warehouse insert fails', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM warehouse_general')) {
      return {
        rows: [{
          id: 5,
          material_name: 'Кабель ВВГнг',
          unit: 'м',
          qty_total: '100',
          qty_reserved: '0',
        }],
      };
    }
    if (sql.includes('UPDATE warehouse_general')) return { rows: [] };
    if (sql.includes('INSERT INTO warehouse_project')) throw new Error('insert failed');
    throw new Error(`Unexpected client query: ${sql}`);
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (isMembershipQuery(sql)) return { rows: [{ '?column?': 1 }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(transferToProject, {
    params: { id: 5 },
    body: {
      project_id: 1,
      quantity: 30,
    },
  });

  assert.equal(res.body, null);
  assert.equal(next.error.message, 'insert failed');
  assert.equal(client.calls.some((call) => call.sql === 'ROLLBACK'), true);
  assert.equal(client.calls.some((call) => call.sql === 'COMMIT'), false);
  assert.equal(client.released, true);
});

test('supplier transferToProject rejects insufficient general warehouse balance before updating', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM warehouse_general')) {
      return {
        rows: [{
          id: 5,
          material_name: 'Кабель ВВГнг',
          unit: 'м',
          qty_total: '10',
          qty_reserved: '4',
        }],
      };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (isMembershipQuery(sql)) return { rows: [{ '?column?': 1 }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(transferToProject, {
    params: { id: 5 },
    body: {
      project_id: 1,
      quantity: 7,
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Недостаточно на складе. Доступно: 6');
  assert.equal(client.calls.some((call) => call.sql.includes('UPDATE warehouse_general')), false);
  assert.equal(client.calls.some((call) => call.sql === 'ROLLBACK'), true);
  assert.equal(client.released, true);
});

test('foreman writeoffWarehouse writes off material and records stage writeoff transactionally', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('UPDATE warehouse_project')) {
      return {
        rows: [{
          id: 7,
          material_name: 'Кабель ВВГнг',
          qty_total: '50',
          qty_used: '15',
        }],
      };
    }
    if (sql.includes('INSERT INTO warehouse_writeoffs')) return { rows: [] };
    throw new Error(`Unexpected client query: ${sql}`);
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM warehouse_project')) {
      return { rows: [{ id: 7, project_id: 1, qty_total: '50', qty_used: '10' }] };
    }
    if (isMembershipQuery(sql)) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM project_stages')) return { rows: [{ id: 3 }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(writeoffWarehouse, {
    params: { id: 7 },
    body: {
      quantity: 5,
      stage_id: 3,
    },
    userRole: ROLES.FOREMAN,
  });

  assert.equal(next.error, null);
  assert.equal(res.body.success, true);
  assert.deepEqual(client.calls.map((call) => call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : call.sql.match(/^(UPDATE|INSERT)/)?.[1]), [
    'BEGIN',
    'UPDATE',
    'INSERT',
    'COMMIT',
  ]);
  assert.deepEqual(client.calls.find((call) => call.sql.includes('UPDATE warehouse_project')).params, [5, 7]);
  assert.deepEqual(client.calls.find((call) => call.sql.includes('INSERT INTO warehouse_writeoffs')).params, [7, 1, 3, 5, 10]);
  assert.equal(client.released, true);
});

test('foreman writeoffWarehouse rejects overdraw and does not open transaction', async (t) => {
  const connectMock = t.mock.method(pool, 'connect', async () => {
    throw new Error('Transaction should not start');
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM warehouse_project')) {
      return { rows: [{ id: 7, project_id: 1, qty_total: '12', qty_used: '10' }] };
    }
    if (isMembershipQuery(sql)) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM project_stages')) return { rows: [{ id: 3 }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });

  const { res, next } = await callController(writeoffWarehouse, {
    params: { id: 7 },
    body: {
      quantity: 3,
      stage_id: 3,
    },
    userRole: ROLES.FOREMAN,
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Недостаточно на складе. Доступно: 2');
  assert.equal(connectMock.mock.callCount(), 0);
});

test('supplier fulfillSpec rejects material spec that is not approved', async (t) => {
  const connectMock = t.mock.method(pool, 'connect', async () => {
    throw new Error('Transaction should not start');
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM material_specs ms')) {
      return {
        rows: [{
          id: 11,
          project_id: 1,
          supplier_id: 10,
          material_name: 'Кабель',
          unit: 'м',
          quantity: '20',
          status: 'pending_approval',
          supplied_qty: '0',
        }],
      };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  });

  const { res, next } = await callController(fulfillSpec, {
    params: { id: 11 },
    body: {
      source: 'purchase',
      quantity: 5,
      purchase_price: 100,
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Обеспечивать можно только согласованные позиции');
  assert.equal(connectMock.mock.callCount(), 0);
});

test('supplier fulfillSpec rejects quantity greater than remaining spec amount', async (t) => {
  const connectMock = t.mock.method(pool, 'connect', async () => {
    throw new Error('Transaction should not start');
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM material_specs ms')) {
      return {
        rows: [{
          id: 11,
          project_id: 1,
          supplier_id: 10,
          material_name: 'Кабель',
          unit: 'м',
          quantity: '20',
          status: 'approved',
          supplied_qty: '18',
        }],
      };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  });

  const { res, next } = await callController(fulfillSpec, {
    params: { id: 11 },
    body: {
      source: 'purchase',
      quantity: 3,
      purchase_price: 100,
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Осталось обеспечить: 2');
  assert.equal(connectMock.mock.callCount(), 0);
});

test('supplier fulfillSpec rolls back company source when general warehouse balance is insufficient', async (t) => {
  const client = createClientMock(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM warehouse_general')) {
      return {
        rows: [{
          id: 5,
          material_name: 'Кабель',
          unit: 'м',
          qty_total: '10',
          qty_reserved: '6',
        }],
      };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  });

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM material_specs ms')) {
      return {
        rows: [{
          id: 11,
          project_id: 1,
          supplier_id: 10,
          material_name: 'Кабель',
          unit: 'м',
          quantity: '20',
          status: 'approved',
          supplied_qty: '0',
        }],
      };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  t.mock.method(pool, 'connect', async () => client);

  const { res, next } = await callController(fulfillSpec, {
    params: { id: 11 },
    body: {
      source: 'company',
      quantity: 5,
      general_item_id: 5,
    },
  });

  assert.equal(next.error, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Недостаточно на общем складе. Доступно: 4');
  assert.equal(client.calls.some((call) => call.sql === 'ROLLBACK'), true);
  assert.equal(client.calls.some((call) => call.sql.includes('UPDATE warehouse_general')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('INSERT INTO warehouse_project')), false);
  assert.equal(client.released, true);
});
