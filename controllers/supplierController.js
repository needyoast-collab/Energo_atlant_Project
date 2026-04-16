const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { ROLES } = require('../middleware/auth');
const { checkMembership, makeJoinProject } = require('../utils/project');
const {
  updateMtrSchema,
  addGeneralWarehouseSchema,
  updateGeneralWarehouseSchema,
  transferToProjectSchema,
  addProjectWarehouseSchema,
  addSpecSchema,
  updateSpecSchema,
  rejectSpecSchema,
  batchSpecSchema,
} = require('../utils/validate');

// ─── Проекты ──────────────────────────────────────────────────

// GET /api/supplier/projects
async function getProjects(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.created_at,
              u.name as manager_name
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE pm.user_id = $1 AND pm.role = 'supplier' AND p.is_deleted = FALSE
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/supplier/projects/join
const joinProject = makeJoinProject(ROLES.SUPPLIER);

// GET /api/supplier/projects/:id
async function getProject(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.created_at,
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

// GET /api/supplier/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT id, name, status, order_num, planned_start, planned_end, actual_end
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

// ─── Заявки МТР ───────────────────────────────────────────────

// GET /api/supplier/projects/:id/mtr-requests
async function getMtrRequests(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT mr.id, mr.material_name, mr.quantity, mr.unit, mr.status, mr.notes, mr.created_at,
              u.name as foreman_name,
              ps.name as stage_name
       FROM material_requests mr
       JOIN users u ON u.id = mr.foreman_id
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

// PUT /api/supplier/mtr-requests/:id
async function updateMtrRequest(req, res, next) {
  try {
    const parsed = updateMtrSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const { status, notes } = parsed.data;

    const mtr = await pool.query(
      `SELECT project_id, foreman_id, material_name FROM material_requests WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!mtr.rows[0]) return res.status(404).json({ success: false, error: 'Заявка не найдена' });

    const isMember = await checkMembership(mtr.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const fields = ['status = $1', 'supplier_id = $2'];
    const values = [status, req.session.userId];
    let idx = 3;

    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }
    values.push(id);

    const result = await pool.query(
      `UPDATE material_requests SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, material_name, status, notes`,
      values
    );

    await sendNotification({
      userId:    mtr.rows[0].foreman_id,
      projectId: mtr.rows[0].project_id,
      type:      'mtr',
      message:   `Заявка МТР «${mtr.rows[0].material_name}» — статус изменён на «${status}»`,
    });

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// ─── Документы ────────────────────────────────────────────────

// GET /api/supplier/projects/:id/documents
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

// ─── Общий склад компании ─────────────────────────────────────

// GET /api/supplier/general-warehouse
async function getGeneralWarehouse(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, material_name, unit, qty_total, qty_reserved, notes, updated_at
       FROM warehouse_general
       ORDER BY material_name`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/supplier/general-warehouse
async function addGeneralWarehouse(req, res, next) {
  try {
    const parsed = addGeneralWarehouseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { material_name, unit, qty_total = 0, notes } = parsed.data;

    const result = await pool.query(
      `INSERT INTO warehouse_general (material_name, unit, qty_total, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, material_name, unit, qty_total, qty_reserved, notes`,
      [material_name, unit || null, qty_total, notes || null]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/supplier/general-warehouse/:id
async function updateGeneralWarehouse(req, res, next) {
  try {
    const parsed = updateGeneralWarehouseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    if (parsed.data.qty_total !== undefined)    { fields.push(`qty_total = $${idx++}`);    values.push(parsed.data.qty_total); }
    if (parsed.data.qty_reserved !== undefined) { fields.push(`qty_reserved = $${idx++}`); values.push(parsed.data.qty_reserved); }
    if (parsed.data.notes !== undefined)        { fields.push(`notes = $${idx++}`);        values.push(parsed.data.notes); }

    if (!fields.length) return res.status(400).json({ success: false, error: 'Нет полей для обновления' });

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE warehouse_general SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, material_name, unit, qty_total, qty_reserved, notes`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'Позиция не найдена' });
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/supplier/general-warehouse/:id/transfer
async function transferToProject(req, res, next) {
  try {
    const parsed = transferToProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const { project_id, quantity, unit, notes } = parsed.data;

    // Проверяем доступ к проекту
    const isMember = await checkMembership(project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    // Берём позицию общего склада
    const item = await pool.query(
      `SELECT id, material_name, unit, qty_total, qty_reserved FROM warehouse_general WHERE id = $1`,
      [id]
    );
    if (!item.rows[0]) return res.status(404).json({ success: false, error: 'Позиция общего склада не найдена' });

    const available = parseFloat(item.rows[0].qty_total) - parseFloat(item.rows[0].qty_reserved);
    if (quantity > available) {
      return res.status(400).json({ success: false, error: `Недостаточно на складе. Доступно: ${available}` });
    }

    // Уменьшаем qty_total на общем складе
    await pool.query(
      `UPDATE warehouse_general SET qty_total = qty_total - $1, updated_at = NOW() WHERE id = $2`,
      [quantity, id]
    );

    // Создаём запись на складе объекта
    const result = await pool.query(
      `INSERT INTO warehouse_project (project_id, material_name, unit, qty_total, source, general_item_id, notes)
       VALUES ($1, $2, $3, $4, 'company', $5, $6)
       RETURNING id, material_name, unit, qty_total, qty_used, source`,
      [project_id, item.rows[0].material_name, unit || item.rows[0].unit, quantity, id, notes || null]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// ─── Склад объекта ────────────────────────────────────────────

// GET /api/supplier/projects/:id/warehouse
async function getWarehouse(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT id, material_name, unit, qty_total, qty_used,
              (qty_total - qty_used) AS qty_balance, source, general_item_id, notes, updated_at
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

// POST /api/supplier/projects/:id/warehouse
async function addProjectWarehouse(req, res, next) {
  try {
    const parsed = addProjectWarehouseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { material_name, unit, qty_total, source, notes } = parsed.data;

    const result = await pool.query(
      `INSERT INTO warehouse_project (project_id, material_name, unit, qty_total, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, material_name, unit, qty_total, qty_used, source`,
      [id, material_name, unit || null, qty_total, source, notes || null]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/supplier/projects/:id/warehouse/export
async function exportWarehouse(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const project = await pool.query(
      `SELECT code, name FROM projects WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!project.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });

    const items = await pool.query(
      `SELECT material_name, unit, qty_total, qty_used,
              (qty_total - qty_used) AS qty_balance, source
       FROM warehouse_project
       WHERE project_id = $1
       ORDER BY material_name`,
      [id]
    );

    const SOURCE_LABELS = { company: 'Общий склад', purchase: 'Закупка', customer: 'От заказчика' };
    const header = 'Материал;Ед.изм.;Получено;Использовано;Остаток;Источник\n';
    const rows = items.rows.map(r =>
      `${r.material_name};${r.unit || ''};${r.qty_total};${r.qty_used};${r.qty_balance};${SOURCE_LABELS[r.source] || r.source}`
    ).join('\n');

    const filename = `warehouse_${project.rows[0].code}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\uFEFF' + header + rows);
  } catch (err) {
    return next(err);
  }
}

// ─── Ведомость материалов ─────────────────────────────────────

// GET /api/supplier/projects/:id/specs
async function getSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT ms.id, ms.material_name, ms.unit, ms.quantity, ms.status,
              ms.rejection_note, ms.approved_at, ms.created_at,
              u.name AS approved_by_name
       FROM material_specs ms
       LEFT JOIN users u ON u.id = ms.approved_by
       WHERE ms.project_id = $1 AND ms.supplier_id = $2 AND ms.is_deleted = FALSE
       ORDER BY ms.created_at`,
      [id, req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/supplier/projects/:id/specs
async function addSpec(req, res, next) {
  try {
    const parsed = addSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const { material_name, unit, quantity } = parsed.data;

    const result = await pool.query(
      `INSERT INTO material_specs (project_id, supplier_id, material_name, unit, quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, material_name, unit, quantity, status`,
      [id, req.session.userId, material_name, unit || null, quantity]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/supplier/specs/:id
async function updateSpec(req, res, next) {
  try {
    const parsed = updateSpecSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;

    const spec = await pool.query(
      `SELECT project_id, supplier_id, status FROM material_specs WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция не найдена' });
    if (spec.rows[0].supplier_id !== req.session.userId) return res.status(403).json({ success: false, error: 'Нет доступа' });
    if (spec.rows[0].status !== 'draft') return res.status(400).json({ success: false, error: 'Можно редактировать только черновик' });

    const fields = [];
    const values = [];
    let idx = 1;

    if (parsed.data.material_name !== undefined) { fields.push(`material_name = $${idx++}`); values.push(parsed.data.material_name); }
    if (parsed.data.unit !== undefined)          { fields.push(`unit = $${idx++}`);          values.push(parsed.data.unit); }
    if (parsed.data.quantity !== undefined)      { fields.push(`quantity = $${idx++}`);      values.push(parsed.data.quantity); }

    if (!fields.length) return res.status(400).json({ success: false, error: 'Нет полей для обновления' });

    values.push(id);
    const result = await pool.query(
      `UPDATE material_specs SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, material_name, unit, quantity, status`,
      values
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/supplier/specs/:id
async function deleteSpec(req, res, next) {
  try {
    const { id } = req.params;

    const spec = await pool.query(
      `SELECT supplier_id, status FROM material_specs WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!spec.rows[0]) return res.status(404).json({ success: false, error: 'Позиция не найдена' });
    if (spec.rows[0].supplier_id !== req.session.userId) return res.status(403).json({ success: false, error: 'Нет доступа' });
    if (spec.rows[0].status !== 'draft') return res.status(400).json({ success: false, error: 'Можно удалить только черновик' });

    await pool.query(`UPDATE material_specs SET is_deleted = TRUE WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// POST /api/supplier/projects/:id/specs/batch
async function batchAddSpecs(req, res, next) {
  try {
    const parsed = batchSpecSchema.safeParse(req.body);
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
          `INSERT INTO material_specs (project_id, supplier_id, material_name, unit, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, req.session.userId, item.material_name, item.unit || null, item.quantity]
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

// POST /api/supplier/projects/:id/specs/submit
async function submitSpecs(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    // Переводим все draft-позиции этого снабженца → pending_approval
    const updated = await pool.query(
      `UPDATE material_specs SET status = 'pending_approval'
       WHERE project_id = $1 AND supplier_id = $2 AND status = 'draft' AND is_deleted = FALSE
       RETURNING id`,
      [id, req.session.userId]
    );

    if (!updated.rows.length) {
      return res.status(400).json({ success: false, error: 'Нет позиций в статусе «Черновик»' });
    }

    // Уведомляем всех прорабов проекта
    const foremans = await pool.query(
      `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'foreman'`,
      [id]
    );
    await Promise.all(foremans.rows.map(f =>
      sendNotification({
        userId:    f.user_id,
        projectId: parseInt(id),
        type:      'mtr',
        message:   'Снабженец отправил ведомость материалов на согласование',
      })
    ));

    return res.json({ success: true, data: { submitted: updated.rows.length } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getProjects,
  joinProject,
  getProject,
  getStages,
  getMtrRequests,
  updateMtrRequest,
  getProjectDocuments,
  getGeneralWarehouse,
  addGeneralWarehouse,
  updateGeneralWarehouse,
  transferToProject,
  getWarehouse,
  addProjectWarehouse,
  exportWarehouse,
  getSpecs,
  addSpec,
  updateSpec,
  deleteSpec,
  submitSpecs,
  batchAddSpecs,
};
