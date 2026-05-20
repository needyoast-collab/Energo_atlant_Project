const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  FOREMAN: 'foreman',
  SUPPLIER: 'supplier',
  PTO: 'pto',
  CUSTOMER: 'customer',
  PARTNER: 'partner',
});

const ROLE_VALUES = Object.freeze(Object.values(ROLES));
const PUBLIC_REGISTRATION_ROLES = Object.freeze([ROLES.CUSTOMER, ROLES.PARTNER]);
const PROJECT_TEAM_ROLES = Object.freeze([ROLES.FOREMAN, ROLES.SUPPLIER, ROLES.PTO, ROLES.CUSTOMER]);
const MANAGER_STAFF_ROLES = Object.freeze([...PROJECT_TEAM_ROLES, ROLES.PARTNER]);

const EXECUTIVE_DOCUMENT_TYPES = Object.freeze([
  'hidden_works_act',
  'exec_scheme',
  'geodetic_survey',
  'general_works_log',
  'author_supervision',
  'interim_acceptance',
  'cable_test_act',
  'measurement_protocol',
  'other',
]);

const TECHNICAL_DOCUMENT_TYPES = Object.freeze([
  'rd',
  'tu',
  'pd',
  'tz',
  'construction_permit',
  'arbp',
  'exec_scheme',
  'hidden_works_act',
  'geodetic_survey',
  'general_works_log',
  'author_supervision',
  'interim_acceptance',
  'cable_test_act',
  'measurement_protocol',
  'other',
]);

const FINANCIAL_DOCUMENT_TYPES = Object.freeze([
  'kp',
  'estimate',
  'contract',
  'additional_agreement',
  'ks2',
  'ks3',
]);

const PROJECT_DOCUMENT_TYPES = Object.freeze([
  ...TECHNICAL_DOCUMENT_TYPES.filter((type) => type !== 'other'),
  ...FINANCIAL_DOCUMENT_TYPES,
  'other',
]);

const LEGACY_PROJECT_DOCUMENT_TYPE_ALIASES = Object.freeze({
  addendum: 'additional_agreement',
  permit: 'construction_permit',
  boundary_act: 'arbp',
});

const PROJECT_DOCUMENT_LABELS = Object.freeze({
  hidden_works_act: 'Акт скрытых работ',
  exec_scheme: 'Исполнительная схема',
  geodetic_survey: 'Геодезическая исполнительная съёмка',
  general_works_log: 'Общий журнал работ',
  author_supervision: 'Журнал авторского надзора',
  interim_acceptance: 'Акт промежуточной приёмки',
  cable_test_act: 'Акт испытания кабельной линии',
  measurement_protocol: 'Протокол измерений',
  rd: 'Рабочая документация (РД)',
  tu: 'Технические условия (ТУ)',
  pd: 'Проектная документация (ПД)',
  tz: 'Техническое задание (ТЗ)',
  construction_permit: 'Разрешение на строительство',
  arbp: 'Акт разграничения балансовой принадлежности',
  kp: 'Коммерческое предложение (КП)',
  estimate: 'Смета / локальный сметный расчёт',
  contract: 'Договор подряда',
  additional_agreement: 'Дополнительное соглашение',
  ks2: 'Акт выполненных работ (КС-2)',
  ks3: 'Справка о стоимости (КС-3)',
  other: 'Прочее',
});

const REQUEST_DOCUMENT_TYPES = Object.freeze(['tu', 'rd', 'pd', 'tz', 'situation_plan', 'other']);

function normalizeProjectDocumentType(docType) {
  return LEGACY_PROJECT_DOCUMENT_TYPE_ALIASES[docType] || docType;
}

function isFinancialDocumentType(docType) {
  return FINANCIAL_DOCUMENT_TYPES.includes(normalizeProjectDocumentType(docType));
}

function isTechnicalDocumentType(docType) {
  return TECHNICAL_DOCUMENT_TYPES.includes(normalizeProjectDocumentType(docType));
}

function isProjectDocumentType(docType) {
  return PROJECT_DOCUMENT_TYPES.includes(normalizeProjectDocumentType(docType));
}

function canReadProjectDocumentType(role, docType) {
  if (!isProjectDocumentType(docType)) return false;
  if (!isFinancialDocumentType(docType)) return true;
  return [ROLES.ADMIN, ROLES.MANAGER, ROLES.CUSTOMER].includes(role);
}

function getReadableProjectDocumentTypes(role) {
  const canonical = PROJECT_DOCUMENT_TYPES.filter((docType) => canReadProjectDocumentType(role, docType));
  const aliases = Object.entries(LEGACY_PROJECT_DOCUMENT_TYPE_ALIASES)
    .filter(([, canonicalType]) => canReadProjectDocumentType(role, canonicalType))
    .map(([legacyType]) => legacyType);
  return [...canonical, ...aliases];
}

function getProjectDocumentLabel(docType) {
  const canonicalType = normalizeProjectDocumentType(docType);
  return PROJECT_DOCUMENT_LABELS[canonicalType] || canonicalType || 'Документ';
}

function decorateProjectDocument(doc) {
  const canonicalType = normalizeProjectDocumentType(doc.doc_type);
  return {
    ...doc,
    doc_type: canonicalType,
    doc_label: getProjectDocumentLabel(canonicalType),
    is_financial: isFinancialDocumentType(canonicalType),
    is_technical: isTechnicalDocumentType(canonicalType),
  };
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  PUBLIC_REGISTRATION_ROLES,
  PROJECT_TEAM_ROLES,
  MANAGER_STAFF_ROLES,
  EXECUTIVE_DOCUMENT_TYPES,
  TECHNICAL_DOCUMENT_TYPES,
  FINANCIAL_DOCUMENT_TYPES,
  PROJECT_DOCUMENT_TYPES,
  PROJECT_DOCUMENT_LABELS,
  REQUEST_DOCUMENT_TYPES,
  LEGACY_PROJECT_DOCUMENT_TYPE_ALIASES,
  normalizeProjectDocumentType,
  isFinancialDocumentType,
  isTechnicalDocumentType,
  isProjectDocumentType,
  canReadProjectDocumentType,
  getReadableProjectDocumentTypes,
  getProjectDocumentLabel,
  decorateProjectDocument,
};
