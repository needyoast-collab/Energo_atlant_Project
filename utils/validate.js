const { z } = require('zod');

const registerSchema = z.object({
  name:     z.string().min(2).max(100),
  email:    z.string().email(),
  login:    z.string().min(3).max(100),
  phone:    z.string().min(5).max(20),
  password: z.string().min(8).max(100),
  role:     z.enum(['customer', 'partner']),
});

const loginSchema = z.object({
  identifier: z.string().min(1), // email or login or phone
  password:   z.string().min(1),
});

const forgotPasswordSchema = z.object({
  identifier: z.string().min(1),
});

const resetPasswordSchema = z.object({
  identifier:  z.string().min(1),
  code:        z.string().length(6),
  newPassword: z.string().min(8).max(100),
});

// --- foreman ---

const createStageSchema = z.object({
  name:          z.string().min(1).max(200),
  order_num:     z.number().int().min(0).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateStageSchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  status:        z.enum(['pending', 'in_progress', 'done', 'planned', 'not_done']).optional(),
  order_num:     z.number().int().min(0).optional(),
  planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_end:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_value:  z.number().min(0).optional(),
  planned_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actual_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note:          z.string().max(1000).optional(),
});

const mtrSchema = z.object({
  stage_id:      z.number().int().positive().optional(),
  material_name: z.string().min(1).max(200),
  quantity:      z.number().positive(),
  unit:          z.string().max(20).optional(),
  notes:         z.string().max(1000).optional(),
});

const writeoffSchema = z.object({
  quantity: z.number().positive(),
});

// --- supplier ---

const updateMtrSchema = z.object({
  status:      z.enum(['approved', 'rejected', 'ordered', 'delivered']),
  supplier_id: z.number().int().positive().optional(),
  notes:       z.string().max(1000).optional(),
});

const addGeneralWarehouseSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit:          z.string().max(20).optional(),
  qty_total:     z.number().min(0).optional(),
  notes:         z.string().max(1000).optional(),
});

const updateGeneralWarehouseSchema = z.object({
  qty_total:    z.number().min(0).optional(),
  qty_reserved: z.number().min(0).optional(),
  notes:        z.string().max(1000).optional(),
});

const transferToProjectSchema = z.object({
  project_id: z.number().int().positive(),
  quantity:   z.number().positive(),
  unit:       z.string().max(20).optional(),
  notes:      z.string().max(1000).optional(),
});

const addProjectWarehouseSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit:          z.string().max(20).optional(),
  qty_total:     z.number().min(0).default(0),
  source:        z.enum(['purchase', 'customer']),
  notes:         z.string().max(1000).optional(),
});

const addSpecSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit:          z.string().max(20).optional(),
  quantity:      z.number().positive(),
});

const updateSpecSchema = z.object({
  material_name: z.string().min(1).max(200).optional(),
  unit:          z.string().max(20).optional(),
  quantity:      z.number().positive().optional(),
});

const rejectSpecSchema = z.object({
  rejection_note: z.string().min(1).max(1000),
});

const batchSpecItemSchema = z.object({
  material_name: z.string().min(1).max(200),
  unit:          z.string().max(20).optional(),
  quantity:      z.number().positive(),
});

const batchSpecSchema = z.object({
  items: z.array(batchSpecItemSchema).min(1).max(500),
});

const addWorkSpecSchema = z.object({
  work_name: z.string().min(1).max(200),
  unit:      z.string().max(20).optional(),
  quantity:  z.number().positive(),
});

const updateWorkSpecSchema = z.object({
  work_name: z.string().min(1).max(200).optional(),
  unit:      z.string().max(20).optional(),
  quantity:  z.number().positive().optional(),
});

const batchWorkSpecItemSchema = z.object({
  work_name: z.string().min(1).max(200),
  unit:      z.string().max(20).optional(),
  quantity:  z.number().positive(),
});

const batchWorkSpecSchema = z.object({
  items: z.array(batchWorkSpecItemSchema).min(1).max(500),
});

// --- pto ---

const DOC_TYPES = ['hidden_works_act','exec_scheme','geodetic_survey','general_works_log',
  'author_supervision','interim_acceptance','cable_test_act','measurement_protocol','other'];

const uploadDocSchema = z.object({
  doc_type:    z.enum(DOC_TYPES),
  description: z.string().max(1000).optional(),
});

// --- customer ---

const REQUEST_DOC_TYPES = ['tu', 'rd', 'pd', 'tz', 'situation_plan', 'other'];

const createRequestSchema = z.object({
  message:  z.string().max(2000).optional(),
  phone:    z.string().max(20).optional(),
  doc_type: z.enum(REQUEST_DOC_TYPES).optional(),
});

// --- admin ---

const ALL_ROLES = ['admin', 'manager', 'foreman', 'supplier', 'pto', 'customer', 'partner'];

const createUserSchema = z.object({
  name:     z.string().min(2).max(100),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
  role:     z.enum(ALL_ROLES),
});

const updateUserSchema = z.object({
  name:  z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role:  z.enum(ALL_ROLES).optional(),
});

const updatePayoutSchema = z.object({
  status: z.enum(['pending', 'processing', 'paid', 'rejected']),
});

// --- manager ---

const MANAGER_DOC_TYPES = [
  'rd','pd','tz','tu','kp','estimate','contract',
  'addendum','ks2','ks3','permit','boundary_act','other',
];

const managerUploadDocSchema = z.object({
  doc_type:    z.enum(MANAGER_DOC_TYPES),
  description: z.string().max(1000).optional(),
});

const createProjectSchema = z.object({
  name:            z.string().min(2).max(200),
  description:     z.string().max(2000).optional(),
  address:         z.string().max(300).optional(),
  contract_value:  z.number().positive().optional(),
  object_type:     z.enum(['промышленный','жилой','инфраструктурный','прочее']).optional(),
  voltage_class:   z.enum(['0.4','6','10','35','110']).optional(),
  work_types:      z.array(z.string()).optional(),
  lead_source:     z.enum(['сайт','звонок','партнёр','тендер','повторный']).optional(),
  contact_name:    z.string().max(100).optional(),
  contact_phone:   z.string().max(20).optional(),
  contact_email:   z.string().email().max(100).optional(),
  contact_org:     z.string().max(200).optional(),
  planned_start:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:           z.string().max(2000).optional(),
});

const updateProjectSchema = z.object({
  name:            z.string().min(2).max(200).optional(),
  description:     z.string().max(2000).optional(),
  address:         z.string().max(300).optional(),
  contract_value:  z.number().positive().optional(),
  object_type:     z.enum(['промышленный','жилой','инфраструктурный','прочее']).optional(),
  voltage_class:   z.enum(['0.4','6','10','35','110']).optional(),
  work_types:      z.array(z.string()).optional(),
  lead_source:     z.enum(['сайт','звонок','партнёр','тендер','повторный']).optional(),
  contact_name:    z.string().max(100).optional(),
  contact_phone:   z.string().max(20).optional(),
  contact_email:   z.string().email().max(100).optional(),
  contact_org:     z.string().max(200).optional(),
  planned_start:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planned_end:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:           z.string().max(2000).optional(),
  status:          z.enum(['lead','qualification','visit','offer','negotiation','contract','work','won','lost']).optional(),
  manager_id:      z.number().int().positive().optional(),
});

const updateRequestSchema = z.object({
  status:      z.enum(['new','in_progress','done','rejected']).optional(),
  assigned_to: z.number().int().positive().optional(),
});

const addTeamSchema = z.object({
  user_id: z.number().int().positive(),
  role:    z.enum(['foreman','supplier','pto','customer']),
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
  forgotPasswordSchema,
  resetPasswordSchema,
};
