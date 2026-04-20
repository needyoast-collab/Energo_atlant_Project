const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { ROLES } = require('../middleware/auth');
const { checkMembership, makeJoinProject } = require('../utils/project');
const {
  createStageSchema,
  updateStageSchema,
  mtrSchema,
  writeoffSchema,
  rejectSpecSchema,
  addWorkSpecSchema,
  batchWorkSpecSchema,
} = require('../utils/validate');

// ─── Проекты ──────────────────────────────────────────────────

// GET /api/foreman/projects
async function getProjects(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.stages_generated, p.created_at,
              u.name as manager_name
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE pm.user_id = $1 AND pm.role = 'foreman' AND p.is_deleted = FALSE
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/join
const joinProject = makeJoinProject(ROLES.FOREMAN);

// GET /api/foreman/projects/:id
async function getProject(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.description, p.address, p.contract_value,
              p.stages_generated, p.created_at,
              u.name as manager_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.id = $1 AND p.is_deleted = FALSE`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// ─── Этапы ────────────────────────────────────────────────────

// GET /api/foreman/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const stages = await pool.query(
      `SELECT id, name, status, order_num, planned_start, planned_end, actual_end,
              is_from_vor, vor_item_id, unit, planned_value, actual_value,
              planned_date, actual_date, note, customer_agreed, created_at
       FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY order_num, created_at`,
      [id]
    );
    return res.json({ success: true, data: stages.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/:id/stages
async function createStage(req, res, next) {
  try {
    const parsed = createStageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { name, order_num, planned_start, planned_end } = parsed.data;
    const result = await pool.query(
      `INSERT INTO project_stages (project_id, name, order_num, planned_start, planned_end)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, status, order_num, planned_start, planned_end`,
      [id, name, order_num ?? 0, planned_start || null, planned_end || null]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/foreman/stages/:id
async function updateStage(req, res, next) {
  try {
    const parsed = updateStageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const stage = await pool.query(
      `SELECT project_id FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) { fields.push(`${key} = $${idx++}`); values.push(val); }
    }
    if (!fields.length) return res.status(400).json({ success: false, error: 'Нет полей для обновления' });

    values.push(id);
    const result = await pool.query(
      `UPDATE project_stages SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, name, status, order_num, planned_start, planned_end, actual_end`,
      values
    );

    if (parsed.data.status === 'not_done') {
      if (!parsed.data.note) {
        return res.status(400).json({ success: false, error: 'Примечание обязательно при статусе «Не выполнено»' });
      }
      const customers = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'customer'`,
        [stage.rows[0].project_id]
      );
      await Promise.all(customers.rows.map(c =>
        sendNotification({
          userId:    c.user_id,
          projectId: stage.rows[0].project_id,
          type:      'status',
          message:   `Требуется согласование по этапу: ${result.rows[0].name}`,
        })
      ));
    }

    if (parsed.data.status === 'done') {
      const members = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1`,
        [stage.rows[0].project_id]
      );
      await Promise.all(members.rows.map(m =>
        sendNotification({
          userId:    m.user_id,
          projectId: stage.rows[0].project_id,
          type:      'status',
          message:   `Этап «${result.rows[0].name}» завершён`,
        })
      ));
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/stages/:id/photos
async function uploadPhoto(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'Файл не загружен' });

    const stage = await pool.query(
      `SELECT project_id FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const fileKey = `photos/${stage.rows[0].project_id}/${id}/${randomUUID()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         fileKey,
      Body:        req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const result = await pool.query(
      `INSERT INTO stage_photos (stage_id, uploaded_by, file_key, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, file_key, description, uploaded_at`,
      [id, req.session.userId, fileKey, req.body.description || null]
    );

    const project = await pool.query(
      `SELECT manager_id FROM projects WHERE id = $1`,
      [stage.rows[0].project_id]
    );
    if (project.rows[0]?.manager_id) {
      await sendNotification({
        userId:    project.rows[0].manager_id,
        projectId: stage.rows[0].project_id,
        type:      'photo',
        message:   'Прораб загрузил новое фото этапа',
      });
    }

    const signedUrl = await getSignedDownloadUrl(fileKey);
    return res.status(201).json({ success: true, data: { ...result.rows[0], url: signedUrl } });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/:id/stages/generate-from-vor
async function generateStagesFromVOR(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

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
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY created_at`,
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

      await client.query(
        `UPDATE projects SET stages_generated = true WHERE id = $1`,
        [id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const stages = await pool.query(
      `SELECT id, name, status, order_num, is_from_vor, vor_item_id, unit, planned_value, actual_value
       FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY order_num`,
      [id]
    );

    return res.status(201).json({ success: true, data: stages.rows });
  } catch (err) {
    return next(err);
  }
}

// ─── Склад объекта ────────────────────────────────────────────

// GET /api/foreman/projects/:id/warehouse
async function getWarehouse(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

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

// POST /api/foreman/warehouse/:id/writeoff
async function writeoffWarehouse(req, res, next) {
  try {
    const parsed = writeoffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const { quantity } = parsed.data;

    const item = await pool.query(
      `SELECT id, project_id, qty_total, qty_used FROM warehouse_project WHERE id = $1`,
      [id]
    );
    if (!item.rows[0]) return res.status(404).json({ success: false, error: 'Позиция склада не найдена' });

    const isMember = await checkMembership(item.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const available = parseFloat(item.rows[0].qty_total) - parseFloat(item.rows[0].qty_used);
    if (quantity > available) {
      return res.status(400).json({ success: false, error: `Недостаточно на складе. Доступно: ${available}` });
    }

    const result = await pool.query(
      `UPDATE warehouse_project
       SET qty_used = qty_used + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, material_name, qty_total, qty_used`,
      [quantity, id]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// ─── Заявки МТР ───────────────────────────────────────────────

// POST /api/foreman/projects/:id/mtr-requests
async function createMtrRequest(req, res, next) {
  try {
    const parsed = mtrSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { stage_id, material_name, quantity, unit, notes } = parsed.data;
    const result = await pool.query(
      `INSERT INTO material_requests (project_id, stage_id, foreman_id, material_name, quantity, unit, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, material_name, quantity, unit, status, created_at`,
      [id, stage_id || null, req.session.userId, material_name, quantity, unit || null, notes || null]
    );

    const suppliers = await pool.query(
      `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'supplier'`,
      [id]
    );
    await Promise.all(suppliers.rows.map(s =>
      sendNotification({
        userId:    s.user_id,
        projectId: parseInt(id),
        type:      'mtr',
        message:   `Новая заявка МТР: ${material_name}`,
      })
    ));

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/foreman/projects/:id/mtr-requests
async function getMtrRequests(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT mr.id, mr.material_name, mr.quantity, mr.unit, mr.status, mr.notes, mr.created_at,
              ps.name as stage_name
       FROM material_requests mr
       LEFT JOIN project_stages ps ON ps.id = mr.stage_id
       WHERE mr.project_id = $1 AND mr.is_deleted = FALSE
       ORDER BY mr.created_at DESC`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// ─── Ведомость материалов ─────────────────────────────────────

// GET /api/foreman/projects/:id/specs
async function getSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT ms.id, ms.material_name, ms.unit, ms.quantity, ms.status,
              ms.rejection_note, ms.approved_at, ms.created_at,
              u.name AS supplier_name
       FROM material_specs ms
       JOIN users u ON u.id = ms.supplier_id
       WHERE ms.project_id = $1 AND ms.is_deleted = FALSE
       ORDER BY ms.created_at`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/foreman/specs/:id/approve
async function approveSpec(req, res, next) {
  try {
    const { id } = req.params;

    const spec = await pool.query(
      `SELECT project_id, status, material_name, supplier_id
       FROM material_specs WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция не найдена' });

    const isMember = await checkMembership(spec.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    if (spec.rows[0].status !== 'pending_approval') {
      return res.status(400).json({ success: false, error: 'Позиция не ожидает согласования' });
    }

    const result = await pool.query(
      `UPDATE material_specs
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2
       RETURNING id, material_name, status, approved_at`,
      [req.session.userId, id]
    );

    await sendNotification({
      userId:    spec.rows[0].supplier_id,
      projectId: spec.rows[0].project_id,
      type:      'mtr',
      message:   `Позиция ведомости «${spec.rows[0].material_name}» согласована`,
    });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/foreman/specs/:id/reject
async function rejectSpec(req, res, next) {
  try {
    const parsed = rejectSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const { rejection_note } = parsed.data;

    const spec = await pool.query(
      `SELECT project_id, status, material_name, supplier_id
       FROM material_specs WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция не найдена' });

    const isMember = await checkMembership(spec.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    if (spec.rows[0].status !== 'pending_approval') {
      return res.status(400).json({ success: false, error: 'Позиция не ожидает согласования' });
    }

    const result = await pool.query(
      `UPDATE material_specs
       SET status = 'rejected', rejection_note = $1
       WHERE id = $2
       RETURNING id, material_name, status, rejection_note`,
      [rejection_note, id]
    );

    await sendNotification({
      userId:    spec.rows[0].supplier_id,
      projectId: spec.rows[0].project_id,
      type:      'mtr',
      message:   `Позиция ведомости «${spec.rows[0].material_name}» отклонена: ${rejection_note}`,
    });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// ─── ВОР (ведомость объёмов работ) ───────────────────────────

// GET /api/foreman/projects/:id/work-specs
async function getWorkSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT ws.id, ws.work_name, ws.unit, ws.quantity, ws.status, ws.created_at,
              u.name AS foreman_name
       FROM work_specs ws
       JOIN users u ON u.id = ws.foreman_id
       WHERE ws.project_id = $1 AND ws.is_deleted = FALSE
       ORDER BY ws.created_at`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/:id/work-specs
async function addWorkSpec(req, res, next) {
  try {
    const parsed = addWorkSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { work_name, unit, quantity } = parsed.data;
    const result = await pool.query(
      `INSERT INTO work_specs (project_id, foreman_id, work_name, unit, quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, work_name, unit, quantity, status`,
      [id, req.session.userId, work_name, unit || null, quantity]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/:id/work-specs/batch
async function batchAddWorkSpecs(req, res, next) {
  try {
    const parsed = batchWorkSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { items } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `INSERT INTO work_specs (project_id, foreman_id, work_name, unit, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, req.session.userId, item.work_name, item.unit || null, item.quantity]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.status(201).json({ success: true, data: { inserted: items.length } });
  } catch (err) {
    return next(err);
  }
}

// ─── Документы ────────────────────────────────────────────────

// GET /api/foreman/projects/:id/documents
async function getProjectDocuments(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              u.name AS uploaded_by_name
       FROM project_documents pd
       JOIN users u ON u.id = pd.uploaded_by
       WHERE pd.project_id = $1
       ORDER BY pd.uploaded_at DESC`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getProjects,
  joinProject,
  getProject,
  getStages,
  createStage,
  updateStage,
  generateStagesFromVOR,
  uploadPhoto,
  getWarehouse,
  writeoffWarehouse,
  getMtrRequests,
  createMtrRequest,
  getSpecs,
  approveSpec,
  rejectSpec,
  getWorkSpecs,
  addWorkSpec,
  batchAddWorkSpecs,
  getProjectDocuments,
};
