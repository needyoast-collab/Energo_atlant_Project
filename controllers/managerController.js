const { pool } = require('../config/database');
const { generateProjectCode } = require('../utils/projectCode');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ROLES } = require('../middleware/auth');
const {
  managerUploadDocSchema,
  createProjectSchema,
  updateProjectSchema,
  updateRequestSchema,
  addTeamSchema,
} = require('../utils/validate');

const MANAGER_DOC_LABELS = {
  rd:           'Рабочая документация (РД)',
  pd:           'Проектная документация (ПД)',
  tz:           'Техническое задание (ТЗ)',
  tu:           'Технические условия (ТУ)',
  kp:           'Коммерческое предложение (КП)',
  estimate:     'Смета / локальный сметный расчёт',
  contract:     'Договор подряда',
  addendum:     'Дополнительное соглашение',
  ks2:          'Акт выполненных работ (КС-2)',
  ks3:          'Справка о стоимости (КС-3)',
  permit:       'Разрешение на строительство',
  boundary_act: 'Акт разграничения балансовой принадлежности',
  other:        'Прочее',
};

// GET /api/manager/requests
async function getRequests(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.name, pr.phone, pr.email, pr.message, pr.status, pr.created_at,
              u.id as assigned_to_id, u.name as assigned_to_name
       FROM public_requests pr
       LEFT JOIN users u ON u.id = pr.assigned_to
       WHERE pr.is_deleted = FALSE
       ORDER BY pr.created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/manager/requests/:id
async function updateRequest(req, res, next) {
  try {
    const parsed = updateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { status, assigned_to } = parsed.data;
    const { id } = req.params;

    const fields = [];
    const values = [];
    let idx = 1;

    if (status)      { fields.push(`status = $${idx++}`);      values.push(status); }
    if (assigned_to) { fields.push(`assigned_to = $${idx++}`); values.push(assigned_to); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE public_requests SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, status, assigned_to`,
      values
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Заявка не найдена' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects
async function getProjects(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.contract_value, p.created_at,
              u.id as manager_id, u.name as manager_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.is_deleted = FALSE
       ORDER BY p.created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects
async function createProject(req, res, next) {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const {
      name, description, address, contract_value,
      object_type, voltage_class, work_types, lead_source,
      contact_name, contact_phone, contact_email, contact_org,
      planned_start, planned_end, notes,
    } = parsed.data;
    const code = await generateProjectCode();

    const result = await pool.query(
      `INSERT INTO projects (
         code, name, description, address, contract_value,
         object_type, voltage_class, work_types, lead_source,
         contact_name, contact_phone, contact_email, contact_org,
         planned_start, planned_end, notes, manager_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, code, name, status, address, contract_value, created_at`,
      [
        code, name, description || null, address || null, contract_value || null,
        object_type || null, voltage_class || null,
        work_types ? JSON.stringify(work_types) : null,
        lead_source || null,
        contact_name || null, contact_phone || null, contact_email || null, contact_org || null,
        planned_start || null, planned_end || null, notes || null,
        req.session.userId,
      ]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/manager/projects/:id
async function updateProject(req, res, next) {
  try {
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE projects SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, code, name, status, address, contract_value`,
      values
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    // Уведомление членам команды при смене статуса
    if (parsed.data.status) {
      const members = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1`,
        [id]
      );
      await Promise.all(members.rows.map(m =>
        sendNotification({
          userId:    m.user_id,
          projectId: parseInt(id),
          type:      'status',
          message:   `Статус проекта изменён на «${parsed.data.status}»`,
        })
      ));
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/team
async function addTeamMember(req, res, next) {
  try {
    const parsed = addTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { user_id, role } = parsed.data;
    const { id } = req.params;

    const project = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND is_deleted = FALSE',
      [id]
    );
    if (!project.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    const user = await pool.query(
      'SELECT id, role FROM users WHERE id = $1 AND is_deleted = FALSE AND is_verified = TRUE',
      [user_id]
    );
    if (!user.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    if (user.rows[0].role !== role) {
      return res.status(400).json({ success: false, error: 'Роль пользователя не совпадает' });
    }

    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [id, user_id, role]
    );

    await sendNotification({
      userId:    user_id,
      projectId: parseInt(id),
      type:      'status',
      message:   `Вас добавили в проект`,
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/analyze
async function analyzeProject(req, res, next) {
  try {
    const { id } = req.params;

    const project = await pool.query(
      `SELECT p.name, p.description, p.address, p.contract_value, p.status
       FROM projects p
       WHERE p.id = $1 AND p.is_deleted = FALSE`,
      [id]
    );

    if (!project.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    const stages = await pool.query(
      `SELECT name, status, planned_start, planned_end, actual_end
       FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY order_num`,
      [id]
    );

    const mtr = await pool.query(
      `SELECT material_name, quantity, unit, status
       FROM material_requests
       WHERE project_id = $1 AND is_deleted = FALSE`,
      [id]
    );

    const p = project.rows[0];
    const prompt = `
Ты — эксперт по строительным проектам в сфере электромонтажа.
Проанализируй следующий проект и дай краткие рекомендации (до 300 слов) на русском языке.

Проект: ${p.name}
Статус: ${p.status}
Адрес: ${p.address || 'не указан'}
Сумма договора: ${p.contract_value ? p.contract_value + ' руб.' : 'не указана'}
Описание: ${p.description || 'не указано'}

Этапы:
${stages.rows.map(s => `- ${s.name} [${s.status}] план: ${s.planned_start || '?'} — ${s.planned_end || '?'}`).join('\n') || 'нет этапов'}

Заявки МТР:
${mtr.rows.map(m => `- ${m.material_name} ${m.quantity} ${m.unit || ''} [${m.status}]`).join('\n') || 'нет заявок'}

Дай оценку рисков, узких мест и рекомендации по улучшению.
`.trim();

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const geminiResult = await model.generateContent(prompt);
    const analysis = geminiResult.response.text();

    return res.json({ success: true, data: { analysis } });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/documents
async function uploadDocument(req, res, next) {
  try {
    const parsed = managerUploadDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    const { id } = req.params;
    const project = await pool.query(
      `SELECT id FROM projects WHERE id = $1 AND is_deleted = FALSE AND manager_id = $2`,
      [id, req.session.userId]
    );
    if (!project.rows[0] && req.session.userRole !== ROLES.ADMIN) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const { doc_type, description } = parsed.data;
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const fileKey = `documents/${id}/manager/${doc_type}/${randomUUID()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         fileKey,
      Body:        req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const result = await pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, doc_type, file_name, description, uploaded_at`,
      [id, req.session.userId, doc_type, fileKey, req.file.originalname, description || null]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/documents
async function getDocuments(req, res, next) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              u.name as uploaded_by_name, u.id as uploaded_by_id
       FROM project_documents pd
       JOIN users u ON u.id = pd.uploaded_by
       WHERE pd.project_id = $1
       ORDER BY pd.uploaded_at DESC`,
      [id]
    );

    const docs = await Promise.all(result.rows.map(async doc => ({
      ...doc,
      url: await getSignedDownloadUrl(doc.file_key),
    })));

    return res.json({ success: true, data: docs });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/manager/documents/:id
async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;

    const doc = await pool.query(
      `SELECT pd.id, pd.file_key, pd.uploaded_by, pd.project_id
       FROM project_documents pd
       WHERE pd.id = $1`,
      [id]
    );

    if (!doc.rows[0]) {
      return res.status(404).json({ success: false, error: 'Документ не найден' });
    }

    // Удалять может менеджер проекта или admin
    if (doc.rows[0].uploaded_by !== req.session.userId && req.session.userRole !== ROLES.ADMIN) {
      return res.status(403).json({ success: false, error: 'Нет доступа' });
    }

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.rows[0].file_key }));
    await pool.query(`DELETE FROM project_documents WHERE id = $1`, [id]);

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/doc-types
function getDocTypes(req, res) {
  return res.json({ success: true, data: MANAGER_DOC_LABELS });
}

// GET /api/manager/staff
async function getStaff(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, role, name, email, is_verified
       FROM users
       WHERE is_deleted = FALSE
         AND role IN ('foreman','supplier','pto','customer','partner')
       ORDER BY role, name`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getRequests,
  updateRequest,
  getProjects,
  createProject,
  updateProject,
  addTeamMember,
  analyzeProject,
  getStaff,
  uploadDocument,
  getDocuments,
  deleteDocument,
  getDocTypes,
};
