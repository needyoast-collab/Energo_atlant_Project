const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().trim().optional().or(z.literal('')),
  login: z.string().min(3).max(50),
  phone: z.string().trim().optional().or(z.literal('')),
  password: z.string().min(8).max(100),
  role: z.enum(['customer', 'partner']),
}).superRefine((data, ctx) => {
  const hasEmail = Boolean(String(data.email || '').trim());
  const hasPhone = Boolean(String(data.phone || '').trim());

  if (!hasEmail && !hasPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: 'Укажите email или телефон',
    });
  }

  if (hasEmail) {
    const emailCheck = z.string().email().safeParse(String(data.email).trim());
    if (!emailCheck.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'Укажите корректный email',
      });
    }
  }

  if (hasPhone) {
    const phone = String(data.phone).trim();
    if (phone.length < 10 || phone.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'Укажите корректный номер телефона',
      });
    }
  }
});

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
});

// --- foreman ---

const createStageSchema = z.object({
  name: z.string().min(1).max(200),
  order_num: z.number().int().min(0).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateStageSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'planned', 'not_done']).optional(),
  order_num: z.number().int().min(0).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_value: z.number().min(0).optional(),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).optional(),
});

const mtrSchema = z.object({
  stage_id: z.number().int().positive().optional(),
  material_name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unit: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

const writeoffSchema = z.object({
  quantity: z.number().positive(),
  stage_id: z.number().int().positive(),
});

// --- supplier ---

const updateMtrSchema = z.object({
  status: z.enum(['approved', 'rejected', 'ordered', 'delivered']),
  supplier_id: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

const addGeneralWarehouseSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  qty_total: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
});

const updateGeneralWarehouseSchema = z.object({
  unit: z.string().max(20).optional(),
  qty_total: z.number().min(0).optional(),
  qty_reserved: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
});

const transferToProjectSchema = z.object({
  project_id: z.number().int().positive(),
  quantity: z.number().positive(),
  unit: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

const addProjectWarehouseSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  qty_total: z.number().min(0).default(0),
  source: z.enum(['purchase', 'customer']),
  purchase_price: z.number().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
});

const fulfillSpecSchema = z.object({
  source: z.enum(['company', 'purchase', 'customer']),
  quantity: z.number().positive(),
  general_item_id: z.number().int().positive().optional(),
  purchase_price: z.number().nonnegative().optional(),
  unit: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.source === 'company' && !data.general_item_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['general_item_id'],
      message: 'Выберите позицию общего склада',
    });
  }
  if (data.source === 'purchase' && data.purchase_price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['purchase_price'],
      message: 'Укажите цену закупки',
    });
  }
});

const addSpecSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
});

const updateSpecSchema = z.object({
  material_name: z.string().min(1).max(200).optional(),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive().optional(),
  unit_price: z.number().nonnegative().optional(),
});

const rejectSpecSchema = z.object({
  rejection_note: z.string().min(1).max(1000),
});

const batchSpecItemSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
});

const batchSpecSchema = z.object({
  items: z.array(batchSpecItemSchema).min(1).max(500),
});

const addWorkSpecSchema = z.object({
  work_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive(),
  manager_price: z.number().nonnegative().optional(),
});

const updateWorkSpecSchema = z.object({
  work_name: z.string().min(1).max(200).optional(),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive().optional(),
  manager_price: z.number().nonnegative().nullable().optional(),
});

const batchWorkSpecItemSchema = z.object({
  work_name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  quantity: z.number().positive(),
});

const batchWorkSpecSchema = z.object({
  items: z.array(batchWorkSpecItemSchema).min(1).max(500),
});

// --- pto ---

const DOC_TYPES = ['hidden_works_act', 'exec_scheme', 'geodetic_survey', 'general_works_log',
  'author_supervision', 'interim_acceptance', 'cable_test_act', 'measurement_protocol', 'other'];

const uploadDocSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  description: z.string().max(1000).optional(),
});

// --- customer ---

const REQUEST_DOC_TYPES = ['tu', 'rd', 'pd', 'tz', 'situation_plan', 'other'];

const createRequestSchema = z.object({
  message: z.string().max(2000).optional(),
  phone: z.string().max(20).optional(),
  doc_type: z.enum(REQUEST_DOC_TYPES).optional(),
});

// --- admin ---

const ALL_ROLES = ['admin', 'manager', 'foreman', 'supplier', 'pto', 'customer', 'partner'];

const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: z.enum(ALL_ROLES),
});

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(ALL_ROLES).optional(),
});

const updatePayoutSchema = z.object({
  status: z.enum(['pending', 'processing', 'paid', 'rejected']),
});

// --- manager ---

const MANAGER_DOC_TYPES = [
  'rd', 'pd', 'tz', 'tu', 'kp', 'estimate', 'contract',
  'addendum', 'ks2', 'ks3', 'permit', 'boundary_act', 'other',
];

const managerUploadDocSchema = z.object({
  doc_type: z.enum(MANAGER_DOC_TYPES),
  description: z.string().max(1000).optional(),
});

const createProjectSchema = z.object({
  name: z.string().min(2).max(200),
  request_id: z.number().int().positive().optional(),
  description: z.string().max(2000).optional(),
  address: z.string().trim().min(1, 'Укажите адрес объекта').max(300),
  contract_value: z.number().positive().optional(),
  include_materials: z.boolean().optional(),
  object_type: z.enum(['промышленный', 'жилой', 'инфраструктурный', 'прочее']).optional(),
  voltage_class: z.enum(['0.4', '6', '10', '35', '110']).optional(),
  work_types: z.array(z.string()).optional(),
  lead_source: z.enum(['сайт', 'звонок', 'партнёр', 'тендер', 'повторный']).optional(),
  contact_name: z.string().max(100).optional(),
  contact_phone: z.string().max(20).optional(),
  contact_email: z.string().email().max(100).optional(),
  contact_org: z.string().max(200).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  address: z.string().max(300).optional(),
  contract_value: z.number().positive().optional(),
  include_materials: z.boolean().optional(),
  regional_coeff: z.number().positive().optional(),
  object_type: z.enum(['промышленный', 'жилой', 'инфраструктурный', 'прочее']).optional(),
  voltage_class: z.enum(['0.4', '6', '10', '35', '110']).optional(),
  work_types: z.array(z.string()).optional(),
  lead_source: z.enum(['сайт', 'звонок', 'партнёр', 'тендер', 'повторный']).optional(),
  contact_name: z.string().max(100).optional(),
  contact_phone: z.string().max(20).optional(),
  contact_email: z.string().email().max(100).optional(),
  contact_org: z.string().max(200).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['lead', 'qualification', 'visit', 'offer', 'negotiation', 'contract', 'work', 'won', 'lost']).optional(),
  manager_id: z.number().int().positive().optional(),
});

const updateRequestSchema = z.object({
  status: z.enum(['new', 'in_progress', 'done', 'rejected']).optional(),
  assigned_to: z.number().int().positive().optional(),
});

const addTeamSchema = z.object({
  user_id: z.number().int().positive(),
  role: z.enum(['foreman', 'supplier', 'pto', 'customer']),
});

const batchCatalogItemSchema = z.object({
  item_name: z.string().min(1).max(200),
  unit:      z.string().min(1).max(20),
  base_price: z.number().min(0).optional(),
});

const batchCatalogSchema = z.object({
  items: z.array(batchCatalogItemSchema).min(1).max(1000),
});

module.exports = {
  registerSchema,
  loginSchema,
  createStageSchema,
  updateStageSchema,
  mtrSchema,
  writeoffSchema,
  updateMtrSchema,
  addGeneralWarehouseSchema,
  updateGeneralWarehouseSchema,
  transferToProjectSchema,
  addProjectWarehouseSchema,
  fulfillSpecSchema,
  addSpecSchema,
  updateSpecSchema,
  rejectSpecSchema,
  batchSpecSchema,
  addWorkSpecSchema,
  updateWorkSpecSchema,
  batchWorkSpecSchema,
  uploadDocSchema,
  createRequestSchema,
  createUserSchema,
  updateUserSchema,
  updatePayoutSchema,
  managerUploadDocSchema,
  createProjectSchema,
  updateProjectSchema,
  updateRequestSchema,
  addTeamSchema,
  batchCatalogSchema,
};
