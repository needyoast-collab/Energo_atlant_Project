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
  createStageSchema,
  updateStageSchema,
  addWorkSpecSchema,
  updateWorkSpecSchema,
} = require('../utils/validate');

const MANAGER_DOC_LABELS = {
  rd: 'Рабочая документация (РД)',
  pd: 'Проектная документация (ПД)',
  tz: 'Техническое задание (ТЗ)',
  tu: 'Технические условия (ТУ)',
  kp: 'Коммерческое предложение (КП)',
  estimate: 'Смета / локальный сметный расчёт',
  contract: 'Договор подряда',
  addendum: 'Дополнительное соглашение',
  ks2: 'Акт выполненных работ (КС-2)',
  ks3: 'Справка о стоимости (КС-3)',
  permit: 'Разрешение на строительство',
  boundary_act: 'Акт разграничения балансовой принадлежности',
  other: 'Прочее',
};

function isAdminSession(req) {
  return req.session.userRole === ROLES.ADMIN;
}

function formatHistoryValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function logProjectHistory({
  projectId,
  changedBy,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  details = null,
}) {
  await pool.query(
    `INSERT INTO project_history
      (project_id, changed_by, action, field_name, old_value, new_value, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      projectId,
      changedBy || null,
      action,
      fieldName,
      formatHistoryValue(oldValue),
      formatHistoryValue(newValue),
      details,
    ]
  );
}

async function getManagerProject(projectId, req) {
  const values = [projectId];
  let where = 'p.id = $1 AND p.is_deleted = FALSE';

  if (!isAdminSession(req)) {
    values.push(req.session.userId);
    where += ' AND p.manager_id = $2';
  }

  const result = await pool.query(
    `SELECT p.id, p.manager_id
     FROM projects p
     WHERE ${where}`,
    values
  );
  return result.rows[0] || null;
}

async function ensureManagerProjectAccess(projectId, req, res) {
  const project = await getManagerProject(projectId, req);
  if (!project) {
    res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    return null;
  }
  return project;
}

async function syncPendingCatalogWork({ workName, unit, managerPrice, addedBy }) {
  const normalizedName = String(workName || '').trim();
  const normalizedUnit = String(unit || '').trim();
  const price = Number(managerPrice);

  if (!normalizedName || !normalizedUnit || !Number.isFinite(price) || price <= 0) {
    return;
  }

  const existing = await pool.query(
    `SELECT id, is_approved
     FROM price_catalog
     WHERE item_type = 'work'
       AND LOWER(item_name) = LOWER($1)
     LIMIT 1`,
    [normalizedName]
  );

  if (existing.rows[0]?.is_approved) {
    return;
  }

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE price_catalog
       SET unit = $1,
           base_price = $2,
           added_by = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [normalizedUnit, price, addedBy, existing.rows[0].id]
    );
    return;
  }

  await pool.query(
    `INSERT INTO price_catalog
      (item_type, item_name, unit, base_price, is_approved, added_by)
     VALUES ('work', $1, $2, $3, FALSE, $4)`,
    [normalizedName, normalizedUnit, price, addedBy]
  );
}

async function attachCustomerFromRequest({ projectId, requestId, changedBy }) {
  if (!requestId) return null;

  const requestResult = await pool.query(
    `SELECT id, name, phone, email
     FROM public_requests
     WHERE id = $1 AND is_deleted = FALSE`,
    [requestId]
  );

  const request = requestResult.rows[0];
  if (!request) {
    return null;
  }

  let customer = null;

  if (request.email) {
    const byEmail = await pool.query(
      `SELECT id, name
       FROM users
       WHERE role = 'customer'
         AND is_deleted = FALSE
         AND email = $1
       LIMIT 1`,
      [request.email]
    );
    customer = byEmail.rows[0] || null;
  }

  if (!customer && request.phone) {
    const byPhone = await pool.query(
      `SELECT id, name
       FROM users
       WHERE role = 'customer'
         AND is_deleted = FALSE
         AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') =
             regexp_replace($1, '\\D', '', 'g')
       LIMIT 1`,
      [request.phone]
    );
    customer = byPhone.rows[0] || null;
  }

  if (!customer) {
    return null;
  }

  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, 'customer')
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, customer.id]
  );

  await sendNotification({
    userId: customer.id,
    projectId,
    type: 'status',
    message: 'Вам назначен новый проект в личном кабинете',
  });

  await logProjectHistory({
    projectId,
    changedBy,
    action: 'attach_customer_from_request',
    details: `Заказчик автоматически привязан из заявки id=${requestId}, user_id=${customer.id}`,
  });

  return customer;
}

async function getProjectCoefficientRows(projectId, db = pool) {
  const result = await db.query(
    `SELECT pc.id, pc.project_id, c.id AS coefficient_id, c.name, c.value, c.description
     FROM project_coefficients pc
     JOIN price_coefficients c ON c.id = pc.coefficient_id
     WHERE pc.project_id = $1
     ORDER BY c.name ASC`,
    [projectId]
  );
  return result.rows;
}

function calculateProjectCoefficientTotal(rows) {
  if (!rows.length) return 1;
  return rows.reduce((acc, row) => acc * Number(row.value), 1);
}

async function recalculateProjectRegionalCoeff(projectId, db = pool) {
  const rows = await getProjectCoefficientRows(projectId, db);
  const total = calculateProjectCoefficientTotal(rows);

  await db.query(
    `UPDATE projects
     SET regional_coeff = $1
     WHERE id = $2`,
    [total, projectId]
  );

  return { total, rows };
}

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

    if (status) { fields.push(`status = $${idx++}`); values.push(status); }
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
    const isAdmin = isAdminSession(req);
    const values = [];
    let managerFilter = '';
    if (!isAdmin) {
      values.push(req.session.userId);
      managerFilter = 'AND p.manager_id = $1';
    }

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.contract_value,
              p.include_materials, p.regional_coeff, p.stages_generated, p.created_at,
              u.id as manager_id, u.name as manager_name,
              COALESCE(st.stage_total, 0)::int AS stage_total,
              COALESCE(st.stage_done, 0)::int AS stage_done,
              CASE
                WHEN p.status = 'won' OR (COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = COALESCE(st.stage_total, 0)) THEN 'green'
                WHEN COALESCE(st.stage_done, 0) > 0 THEN 'yellow'
                ELSE 'red'
              END AS progress_color
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       LEFT JOIN (
         SELECT ps.project_id,
                COUNT(*) FILTER (WHERE ps.is_deleted = FALSE) AS stage_total,
                COUNT(*) FILTER (WHERE ps.is_deleted = FALSE AND ps.status = 'done') AS stage_done
         FROM project_stages ps
         GROUP BY ps.project_id
       ) st ON st.project_id = p.id
       WHERE p.is_deleted = FALSE
       ${managerFilter}
       ORDER BY p.created_at DESC`
      ,
      values
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id
async function getProject(req, res, next) {
  try {
    const { id } = req.params;
    const isAdmin = isAdminSession(req);
    const values = [id];
    let managerFilter = '';
    if (!isAdmin) {
      values.push(req.session.userId);
      managerFilter = 'AND p.manager_id = $2';
    }
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.description, p.address, p.contract_value,
              p.include_materials, p.regional_coeff,
              p.object_type, p.voltage_class, p.work_types, p.lead_source,
              p.contact_name, p.contact_phone, p.contact_email, p.contact_org,
              p.planned_start, p.planned_end, p.notes, p.stages_generated, p.created_at,
              u.name as manager_name,
              (SELECT COUNT(*) FROM project_stages ps WHERE ps.project_id = p.id AND ps.is_deleted = FALSE)::int AS stage_total,
              (SELECT COUNT(*) FROM project_stages ps WHERE ps.project_id = p.id AND ps.is_deleted = FALSE AND ps.status = 'done')::int AS stage_done
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.id = $1 AND p.is_deleted = FALSE
       ${managerFilter}`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });
    return res.json({ success: true, data: result.rows[0] });
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
      name, request_id, description, address, contract_value, include_materials,
      object_type, voltage_class, work_types, lead_source,
      contact_name, contact_phone, contact_email, contact_org,
      planned_start, planned_end, notes,
    } = parsed.data;
    const code = await generateProjectCode();

    const result = await pool.query(
      `INSERT INTO projects (
         code, name, description, address, contract_value,
         include_materials,
         object_type, voltage_class, work_types, lead_source,
         contact_name, contact_phone, contact_email, contact_org,
         planned_start, planned_end, notes, manager_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id, code, name, status, address, contract_value, include_materials, regional_coeff, created_at`,
      [
        code, name, description || null, address || null, contract_value || null, include_materials ?? true,
        object_type || null, voltage_class || null,
        work_types ? JSON.stringify(work_types) : null,
        lead_source || null,
        contact_name || null, contact_phone || null, contact_email || null, contact_org || null,
        planned_start || null, planned_end || null, notes || null,
        req.session.userId,
      ]
    );

    await logProjectHistory({
      projectId: result.rows[0].id,
      changedBy: req.session.userId,
      action: 'create_project',
      details: `Создан проект «${name}»`,
    });

    await attachCustomerFromRequest({
      projectId: result.rows[0].id,
      requestId: request_id,
      changedBy: req.session.userId,
    });

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
    const before = await pool.query(
      `SELECT id, code, name, status, description, address, contract_value,
              include_materials, regional_coeff,
              object_type, voltage_class, work_types, lead_source,
              contact_name, contact_phone, contact_email, contact_org,
              planned_start, planned_end, notes, manager_id
       FROM projects
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!before.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }
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
    const projectWhereIdx = idx;
    let projectWhere = `id = $${projectWhereIdx} AND is_deleted = FALSE`;
    if (!isAdminSession(req)) {
      values.push(req.session.userId);
      projectWhere += ` AND manager_id = $${idx + 1}`;
    }

    const result = await pool.query(
      `UPDATE projects SET ${fields.join(', ')}
       WHERE ${projectWhere}
       RETURNING id, code, name, status, address, contract_value, include_materials, regional_coeff`,
      values
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    const prev = before.rows[0];
    const changes = Object.entries(parsed.data).filter(([key, val]) => {
      const prevVal = prev[key];
      if (key === 'work_types') {
        return JSON.stringify(prevVal || null) !== JSON.stringify(val || null);
      }
      return formatHistoryValue(prevVal) !== formatHistoryValue(val);
    });

    await Promise.all(changes.map(([key, val]) =>
      logProjectHistory({
        projectId: parseInt(id, 10),
        changedBy: req.session.userId,
        action: 'update_project',
        fieldName: key,
        oldValue: prev[key],
        newValue: val,
      })
    ));

    // Уведомление членам команды при смене статуса
    if (parsed.data.status) {
      const members = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1`,
        [id]
      );
      await Promise.all(members.rows.map(m =>
        sendNotification({
          userId: m.user_id,
          projectId: parseInt(id),
          type: 'status',
          message: `Статус проекта изменён на «${parsed.data.status}»`,
        })
      ));
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/coefficients
async function getProjectCoefficients(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;

    const rows = await getProjectCoefficientRows(id);
    return res.json({
      success: true,
      data: {
        items: rows,
        total: calculateProjectCoefficientTotal(rows),
      },
    });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/manager/projects/:id/coefficients
async function updateProjectCoefficients(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;

    const coefficientIds = Array.isArray(req.body.coefficient_ids)
      ? [...new Set(req.body.coefficient_ids.map((value) => parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0))]
      : [];

    const existingCoefficients = coefficientIds.length
      ? await pool.query(
          `SELECT id, name, value
           FROM price_coefficients
           WHERE id = ANY($1::int[])`,
          [coefficientIds]
        )
      : { rows: [] };

    if (existingCoefficients.rows.length !== coefficientIds.length) {
      return res.status(400).json({ success: false, error: 'Часть коэффициентов не найдена' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM project_coefficients WHERE project_id = $1', [id]);

      for (const coefficientId of coefficientIds) {
        await client.query(
          `INSERT INTO project_coefficients (project_id, coefficient_id)
           VALUES ($1, $2)`,
          [id, coefficientId]
        );
      }

      const { total, rows } = await recalculateProjectRegionalCoeff(id, client);
      await client.query('COMMIT');

      const coeffNames = rows.map((row) => row.name).join(', ') || 'без коэффициентов';
      await logProjectHistory({
        projectId: parseInt(id, 10),
        changedBy: req.session.userId,
        action: 'update_project_coefficients',
        details: `Обновлены коэффициенты проекта: ${coeffNames}. Итоговый коэффициент: ${total.toFixed(3)}`,
      });

      return res.json({
        success: true,
        data: {
          items: rows,
          total,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

    const project = await ensureManagerProjectAccess(id, req, res);
    if (!project) {
      return;
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
      userId: user_id,
      projectId: parseInt(id),
      type: 'status',
      message: `Вас добавили в проект`,
    });

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'add_team_member',
      details: `Добавлен участник user_id=${user_id} роль=${role}`,
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
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;

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
       WHERE w.project_id = $1 AND w.is_deleted = FALSE
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
    const project = await ensureManagerProjectAccess(id, req, res);
    if (!project) return;

    const { doc_type, description } = parsed.data;
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const fileKey = `documents/${id}/manager/${doc_type}/${randomUUID()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const result = await pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, doc_type, file_name, description, uploaded_at`,
      [id, req.session.userId, doc_type, fileKey, req.file.originalname, description || null]
    );

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'upload_document',
      fieldName: 'doc_type',
      newValue: doc_type,
      details: `Загружен документ ${req.file.originalname}`,
    });

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/documents
async function getDocuments(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;

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

    const access = await getManagerProject(doc.rows[0].project_id, req);
    if (!access) {
      return res.status(403).json({ success: false, error: 'Нет доступа' });
    }

    // Удалять может менеджер проекта или admin
    if (!isAdminSession(req) && access.manager_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Нет доступа' });
    }

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.rows[0].file_key }));
    await pool.query(`DELETE FROM project_documents WHERE id = $1`, [id]);

    await logProjectHistory({
      projectId: doc.rows[0].project_id,
      changedBy: req.session.userId,
      action: 'delete_document',
      details: `Удалён документ id=${id}`,
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/requests/:id/files
async function getRequestFiles(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, file_key, file_name, doc_type, uploaded_at
       FROM public_request_files
       WHERE request_id = $1
       ORDER BY uploaded_at`,
      [id]
    );
    const files = await Promise.all(result.rows.map(async f => ({
      ...f,
      url: await getSignedDownloadUrl(f.file_key),
    })));
    return res.json({ success: true, data: files });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/copy-request-files
async function copyRequestFiles(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const { request_id } = req.body;
    if (!request_id) {
      return res.status(400).json({ success: false, error: 'request_id обязателен' });
    }

    const VALID_DOC_TYPES = ['rd', 'pd', 'tz', 'tu', 'kp', 'estimate', 'contract', 'addendum', 'ks2', 'ks3', 'permit', 'boundary_act', 'other'];

    const files = await pool.query(
      `SELECT file_key, file_name, doc_type FROM public_request_files WHERE request_id = $1`,
      [request_id]
    );

    await Promise.all(files.rows.map(f => pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.session.userId, VALID_DOC_TYPES.includes(f.doc_type) ? f.doc_type : 'other', f.file_key, f.file_name]
    )));

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const result = await pool.query(
      `SELECT id, name, status, order_num, planned_start, planned_end, actual_end,
              is_from_vor, unit, planned_value, actual_value, planned_date, actual_date, note, created_at
       FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY order_num, created_at`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/stages
async function createStage(req, res, next) {
  try {
    const parsed = createStageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const { name, order_num, planned_start, planned_end } = parsed.data;
    const result = await pool.query(
      `INSERT INTO project_stages (project_id, name, order_num, planned_start, planned_end)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, status, order_num, planned_start, planned_end`,
      [id, name, order_num ?? 0, planned_start || null, planned_end || null]
    );

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'create_stage',
      details: `Создан этап «${name}»`,
    });

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/manager/stages/:stageId
async function updateStage(req, res, next) {
  try {
    const parsed = updateStageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    const { stageId } = req.params;
    const stage = await pool.query(
      `SELECT project_id, name, status, order_num, planned_start, planned_end, actual_end,
              planned_value, actual_value, planned_date, actual_date, note
       FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [stageId]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });
    const access = await ensureManagerProjectAccess(stage.rows[0].project_id, req, res);
    if (!access) return;

    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) { fields.push(`${key} = $${idx++}`); values.push(val); }
    }
    if (!fields.length) return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
    values.push(stageId);
    const result = await pool.query(
      `UPDATE project_stages SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, name, status, order_num, planned_start, planned_end, actual_end, planned_value, actual_value, planned_date, actual_date, note`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const prev = stage.rows[0];
    const changes = Object.entries(parsed.data).filter(([key, val]) =>
      formatHistoryValue(prev[key]) !== formatHistoryValue(val)
    );
    await Promise.all(changes.map(([key, val]) =>
      logProjectHistory({
        projectId: prev.project_id,
        changedBy: req.session.userId,
        action: 'update_stage',
        fieldName: key,
        oldValue: prev[key],
        newValue: val,
        details: `Этап: ${prev.name}`,
      })
    ));

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/manager/stages/:stageId
async function deleteStage(req, res, next) {
  try {
    const { stageId } = req.params;
    const stage = await pool.query(
      `SELECT project_id FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [stageId]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });
    const access = await ensureManagerProjectAccess(stage.rows[0].project_id, req, res);
    if (!access) return;

    const result = await pool.query(
      `UPDATE project_stages SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [stageId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    await logProjectHistory({
      projectId: stage.rows[0].project_id,
      changedBy: req.session.userId,
      action: 'delete_stage',
      details: `Удалён этап id=${stageId}`,
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/work-specs
async function getWorkSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const result = await pool.query(
      `SELECT w.id, w.work_name, w.unit, w.quantity, w.manager_price, w.created_at,
              pc.base_price AS catalog_price
       FROM work_specs w
       LEFT JOIN price_catalog pc
         ON pc.item_type = 'work'
        AND pc.is_approved = TRUE
        AND LOWER(pc.item_name) = LOWER(w.work_name)
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY w.created_at`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/work-specs
async function addWorkSpec(req, res, next) {
  try {
    const parsed = addWorkSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const { work_name, unit, quantity, manager_price } = parsed.data;
    const result = await pool.query(
      `INSERT INTO work_specs (project_id, foreman_id, work_name, unit, quantity, manager_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, work_name, unit, quantity, manager_price, created_at`,
      [id, req.session.userId, work_name, unit || null, quantity, manager_price ?? null]
    );

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'create_work_spec',
      details: `Добавлена ВОР позиция «${work_name}»`,
    });

    await syncPendingCatalogWork({
      workName,
      unit,
      managerPrice,
      addedBy: req.session.userId,
    });

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/manager/work-specs/:id
async function updateWorkSpec(req, res, next) {
  try {
    const parsed = updateWorkSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const spec = await pool.query(
      `SELECT project_id, work_name, unit, quantity, manager_price
       FROM work_specs
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция ВОР не найдена' });
    const access = await ensureManagerProjectAccess(spec.rows[0].project_id, req, res);
    if (!access) return;

    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (!fields.length) return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
    values.push(id);

    const result = await pool.query(
      `UPDATE work_specs SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, work_name, unit, quantity, manager_price, created_at`,
      values
    );

    const prev = spec.rows[0];
    const changes = Object.entries(parsed.data).filter(([key, val]) =>
      formatHistoryValue(prev[key]) !== formatHistoryValue(val)
    );
    await Promise.all(changes.map(([key, val]) =>
      logProjectHistory({
        projectId: prev.project_id,
        changedBy: req.session.userId,
        action: 'update_work_spec',
        fieldName: key,
        oldValue: prev[key],
        newValue: val,
        details: `ВОР: ${prev.work_name}`,
      })
    ));

    await syncPendingCatalogWork({
      workName: result.rows[0].work_name,
      unit: result.rows[0].unit,
      managerPrice: result.rows[0].manager_price,
      addedBy: req.session.userId,
    });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/manager/work-specs/:id
async function deleteWorkSpec(req, res, next) {
  try {
    const { id } = req.params;
    const spec = await pool.query(
      `SELECT project_id FROM work_specs WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция ВОР не найдена' });
    const access = await ensureManagerProjectAccess(spec.rows[0].project_id, req, res);
    if (!access) return;
    const result = await pool.query(
      `UPDATE work_specs SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE RETURNING id`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Позиция ВОР не найдена' });

    await logProjectHistory({
      projectId: spec.rows[0].project_id,
      changedBy: req.session.userId,
      action: 'delete_work_spec',
      details: `Удалена ВОР позиция id=${id}`,
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// POST /api/manager/projects/:id/stages/generate-from-vor
async function generateStagesFromVOR(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const project = await pool.query(
      `SELECT stages_generated FROM projects WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!project.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });
    if (project.rows[0].stages_generated) {
      return res.status(400).json({ success: false, error: 'Этапы уже сформированы' });
    }
    const workSpecs = await pool.query(
      `SELECT id, work_name, unit, quantity FROM work_specs
       WHERE project_id = $1 AND is_deleted = FALSE ORDER BY created_at`,
      [id]
    );
    if (!workSpecs.rows.length) {
      return res.status(400).json({ success: false, error: 'ВОР пустой — нечего формировать' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < workSpecs.rows.length; i++) {
        const ws = workSpecs.rows[i];
        await client.query(
          `INSERT INTO project_stages
           (project_id, name, status, order_num, is_from_vor, vor_item_id, unit, planned_value, actual_value)
           VALUES ($1, $2, 'planned', $3, true, $4, $5, $6, 0)`,
          [id, ws.work_name, i + 1, ws.id, ws.unit || null, ws.quantity]
        );
      }
      await client.query(`UPDATE projects SET stages_generated = true WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const stages = await pool.query(
      `SELECT id, name, status, order_num FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE ORDER BY order_num`,
      [id]
    );

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'generate_stages_from_vor',
      details: `Сформировано этапов: ${stages.rows.length}`,
    });

    return res.status(201).json({ success: true, data: stages.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/warehouse
async function getProjectWarehouse(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const result = await pool.query(
      `SELECT id, material_name, unit, qty_total, qty_used,
              (qty_total - qty_used) AS qty_balance, source, updated_at
       FROM warehouse_project
       WHERE project_id = $1
       ORDER BY material_name`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/projects/:id/specs
async function getProjectSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const access = await ensureManagerProjectAccess(id, req, res);
    if (!access) return;
    const result = await pool.query(
      `SELECT ms.id, ms.material_name, ms.unit, ms.quantity, ms.unit_price, ms.status,
              ms.rejection_note, ms.approved_at, ms.created_at,
              u.name as supplier_name
       FROM material_specs ms
       LEFT JOIN users u ON u.id = ms.supplier_id
       WHERE ms.project_id = $1 AND ms.is_deleted = FALSE
       ORDER BY ms.created_at`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
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
  getRequestFiles,
  getProjects,
  getProject,
  createProject,
  updateProject,
  getProjectCoefficients,
  updateProjectCoefficients,
  copyRequestFiles,
  addTeamMember,
  analyzeProject,
  getStaff,
  getStages,
  createStage,
  updateStage,
  deleteStage,
  getWorkSpecs,
  addWorkSpec,
  updateWorkSpec,
  deleteWorkSpec,
  generateStagesFromVOR,
  getProjectWarehouse,
  getProjectSpecs,
  uploadDocument,
  getDocuments,
  deleteDocument,
  getDocTypes,
};
