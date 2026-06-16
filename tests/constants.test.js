const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROLES,
  canReadProjectDocumentType,
  decorateProjectDocument,
  getProjectDocumentLabel,
  getReadableProjectDocumentTypes,
  isFinancialDocumentType,
  isTechnicalDocumentType,
  normalizeProjectDocumentType,
} = require('../utils/constants');

test('project document type helpers normalize legacy aliases', () => {
  assert.equal(normalizeProjectDocumentType('addendum'), 'additional_agreement');
  assert.equal(normalizeProjectDocumentType('permit'), 'construction_permit');
  assert.equal(normalizeProjectDocumentType('boundary_act'), 'arbp');
  assert.equal(normalizeProjectDocumentType('contract'), 'contract');
});

test('financial project documents are visible only to admin, manager and customer', () => {
  assert.equal(canReadProjectDocumentType(ROLES.ADMIN, 'contract'), true);
  assert.equal(canReadProjectDocumentType(ROLES.MANAGER, 'estimate'), true);
  assert.equal(canReadProjectDocumentType(ROLES.CUSTOMER, 'ks2'), true);

  assert.equal(canReadProjectDocumentType(ROLES.FOREMAN, 'contract'), false);
  assert.equal(canReadProjectDocumentType(ROLES.SUPPLIER, 'estimate'), false);
  assert.equal(canReadProjectDocumentType(ROLES.PTO, 'ks3'), false);
});

test('technical project documents are readable by production roles', () => {
  assert.equal(canReadProjectDocumentType(ROLES.FOREMAN, 'rd'), true);
  assert.equal(canReadProjectDocumentType(ROLES.SUPPLIER, 'hidden_works_act'), true);
  assert.equal(canReadProjectDocumentType(ROLES.PTO, 'exec_scheme'), true);
  assert.equal(canReadProjectDocumentType(ROLES.CUSTOMER, 'tu'), true);
});

test('readable document types include allowed legacy aliases only', () => {
  const foremanTypes = getReadableProjectDocumentTypes(ROLES.FOREMAN);
  const managerTypes = getReadableProjectDocumentTypes(ROLES.MANAGER);

  assert.equal(foremanTypes.includes('contract'), false);
  assert.equal(foremanTypes.includes('permit'), true);
  assert.equal(managerTypes.includes('addendum'), true);
});

test('decorateProjectDocument returns canonical type, label and flags', () => {
  const decorated = decorateProjectDocument({
    id: 1,
    doc_type: 'addendum',
    file_name: 'agreement.pdf',
  });

  assert.equal(decorated.doc_type, 'additional_agreement');
  assert.equal(decorated.doc_label, getProjectDocumentLabel('additional_agreement'));
  assert.equal(decorated.is_financial, true);
  assert.equal(decorated.is_technical, false);
  assert.equal(isFinancialDocumentType('kp'), true);
  assert.equal(isTechnicalDocumentType('rd'), true);
});
