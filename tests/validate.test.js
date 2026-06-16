const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calendarPlanItemSchema,
  createProjectSchema,
  fulfillSpecSchema,
  managerUploadDocSchema,
  registerSchema,
} = require('../utils/validate');

test('registerSchema requires email or phone and accepts public roles only', () => {
  const base = {
    name: 'Иван Иванов',
    login: 'ivan',
    password: 'password123',
    role: 'customer',
  };

  assert.equal(registerSchema.safeParse(base).success, false);
  assert.equal(registerSchema.safeParse({ ...base, email: 'ivan@example.com' }).success, true);
  assert.equal(registerSchema.safeParse({ ...base, phone: '+7 999 111-22-33' }).success, true);
  assert.equal(registerSchema.safeParse({ ...base, email: 'ivan@example.com', role: 'manager' }).success, false);
});

test('managerUploadDocSchema accepts project document types and rejects unknown types', () => {
  assert.equal(managerUploadDocSchema.safeParse({ doc_type: 'additional_agreement' }).success, true);
  assert.equal(managerUploadDocSchema.safeParse({ doc_type: 'hidden_works_act' }).success, true);
  assert.equal(managerUploadDocSchema.safeParse({ doc_type: 'addendum' }).success, false);
});

test('fulfillSpecSchema enforces source-specific fields', () => {
  assert.equal(fulfillSpecSchema.safeParse({ source: 'company', quantity: 1 }).success, false);
  assert.equal(fulfillSpecSchema.safeParse({ source: 'company', quantity: 1, general_item_id: 5 }).success, true);

  assert.equal(fulfillSpecSchema.safeParse({ source: 'purchase', quantity: 1 }).success, false);
  assert.equal(fulfillSpecSchema.safeParse({ source: 'purchase', quantity: 1, purchase_price: 100 }).success, true);

  assert.equal(fulfillSpecSchema.safeParse({ source: 'customer', quantity: 1 }).success, true);
});

test('calendarPlanItemSchema rejects inverted date ranges', () => {
  assert.equal(calendarPlanItemSchema.safeParse({
    planned_start: '2026-05-10',
    planned_end: '2026-05-09',
  }).success, false);

  assert.equal(calendarPlanItemSchema.safeParse({
    planned_start: '2026-05-10',
    planned_end: '2026-05-10',
  }).success, true);
});

test('createProjectSchema requires name and address but keeps optional project params', () => {
  assert.equal(createProjectSchema.safeParse({
    name: 'ПС 110 кВ',
    address: 'Волгоград',
    include_materials: true,
    voltage_class: '110',
    work_types: ['КЛ', 'ТП'],
  }).success, true);

  assert.equal(createProjectSchema.safeParse({
    name: 'ПС 110 кВ',
    address: '',
  }).success, false);
});
