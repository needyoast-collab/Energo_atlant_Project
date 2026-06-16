const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { getProtectedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { getCalendarPlanPayload } = require('../utils/calendarPlan');
const { getUploadFileExtension, normalizeStoredFileName } = require('../utils/fileNames');
const { deleteStoredObject } = require('../utils/storageObjects');
const {
  ROLES,
  getReadableProjectDocumentTypes,
  decorateProjectDocument,
} = require('../utils/constants');
const {
  createStageSchema,
  updateStageSchema,
  calendarPlanItemSchema,
  mtrSchema,
  writeoffSchema,
  rejectSpecSchema,
  addWorkSpecSchema,
  batchWorkSpecSchema,
} = require('../utils/validate');

async function notifyManagerAboutWorkSpecs(projectId) {
  const project = await pool.query(
    `SELECT manager_id, name
     FROM projects
     WHERE id = $1 AND is_deleted = FALSE`,
    [projectId]
  );

  if (!project.rows[0]?.manager_id) return;

  await sendNotification({
    userId: project.rows[0].manager_id,
    projectId: Number(projectId),
    type: 'status',
    message: `Добавлены новые позиции ВОР по проекту "${project.rows[0].name}"`,
  });
}

// ─── Проекты ──────────────────────────────────────────────────

// GET /api/foreman/projects
async function getProjects(req, res, next) {
  try {
    const isAdmin = req.session.userRole === ROLES.ADMIN;
    const accessJoin = isAdmin ? '' : 'JOIN project_members pm ON pm.project_id = p.id';
    const accessWhere = isAdmin ? '' : 'AND pm.user_id = $1 AND pm.role = $2';
    const values = isAdmin ? [] : [req.session.userId, ROLES.FOREMAN];
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.stages_generated, p.kp_sent_at, p.created_at,
              u.name as manager_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       ${accessJoin}
       WHERE p.is_deleted = FALSE
       ${accessWhere}
       ORDER BY p.created_at DESC`,
      values
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
              p.stages_generated, p.kp_sent_at, p.created_at,
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

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

// GET /api/foreman/projects/:id/calendar-plan
async function getCalendarPlan(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const payload = await getCalendarPlanPayload(id);
    if (!payload) return res.status(404).json({ success: false, error: 'Проект не найден' });
    return res.json({ success: true, data: payload });
  } catch (err) {
    return next(err);
  }
}

// POST /api/foreman/projects/:id/calendar-plan/generate
async function generateCalendarPlan(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const project = await pool.query(
      `SELECT contract_signed_at, planned_start
       FROM projects
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!project.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });

    const contractSignedAt = toDateOnly(project.rows[0].contract_signed_at);
    if (!contractSignedAt) {
      return res.status(400).json({ success: false, error: 'Сначала укажите дату подписания договора в карточке проекта' });
    }
    const baseDate = contractSignedAt;

    const existing = await pool.query(
      `SELECT id
       FROM project_stages
       WHERE project_id = $1 AND is_calendar_mobilization = TRUE AND is_deleted = FALSE`,
      [id]
    );

    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO project_stages
          (project_id, name, status, order_num, planned_start, planned_end, is_calendar_mobilization)
         VALUES ($1, 'Мобилизация на объект', 'pending', 0, $2, $2, TRUE)`,
        [id, baseDate]
      );
    }

    const payload = await getCalendarPlanPayload(id);
    return res.status(201).json({ success: true, data: payload });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/foreman/calendar-plan/items/:id
async function updateCalendarPlanItem(req, res, next) {
  try {
    const parsed = calendarPlanItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });

    const { id } = req.params;
    const item = await pool.query(
      `SELECT id, project_id, is_from_vor, is_calendar_mobilization
       FROM project_stages
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!item.rows[0]) return res.status(404).json({ success: false, error: 'Строка календарного плана не найдена' });
    if (!item.rows[0].is_calendar_mobilization && !item.rows[0].is_from_vor) {
      return res.status(400).json({ success: false, error: 'Эта строка не относится к календарному плану' });
    }

    const isMember = await checkMembership(item.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const { planned_start, planned_end } = parsed.data;
    const result = await pool.query(
      `UPDATE project_stages
       SET planned_start = $1,
           planned_end = $2
       WHERE id = $3 AND is_deleted = FALSE
       RETURNING id, name, status, order_num, planned_start, planned_end, actual_end,
                 is_from_vor, is_calendar_mobilization, unit, planned_value, actual_value,
                 planned_date, actual_date, note`,
      [planned_start, planned_end, id]
    );

    const updated = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...updated,
        planned_start: toDateOnly(updated.planned_start),
        planned_end: toDateOnly(updated.planned_end),
        actual_end: toDateOnly(updated.actual_end),
        planned_date: toDateOnly(updated.planned_date),
        actual_date: toDateOnly(updated.actual_date),
      },
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/foreman/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const stages = await pool.query(
      `SELECT id, name, status, order_num, planned_start, planned_end, actual_end,
              is_from_vor, is_calendar_mobilization, vor_item_id, unit, planned_value, actual_value,
              planned_date, actual_date, note, customer_agreed, created_at
       FROM project_stages
       WHERE project_id = $1 AND is_deleted = FALSE
       ORDER BY order_num, created_at`,
      [id]
    );
    const data = stages.rows.map((stage) => ({
      ...stage,
      planned_start: toDateOnly(stage.planned_start),
      planned_end: toDateOnly(stage.planned_end),
      actual_end: toDateOnly(stage.actual_end),
      planned_date: toDateOnly(stage.planned_date),
      actual_date: toDateOnly(stage.actual_date),
    }));

    return res.json({ success: true, data });
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

    const { name, order_num, planned_start, planned_end, planned_value, unit } = parsed.data;
    const result = await pool.query(
      `INSERT INTO project_stages
         (project_id, name, order_num, planned_start, planned_end, planned_value, unit, actual_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, status, order_num, planned_start, planned_end, planned_value, unit, actual_value`,
      [id, name, order_num ?? 0, planned_start || null, planned_end || null, planned_value || null, unit || null, 0]
    );
    const created = result.rows[0];
    return res.status(201).json({
      success: true,
      data: {
        ...created,
        planned_start: toDateOnly(created.planned_start),
        planned_end: toDateOnly(created.planned_end),
      },
    });
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
      `SELECT project_id, status, is_from_vor, planned_value, planned_end, actual_end, planned_date, actual_date, note
       FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    if (parsed.data.status === 'not_done' && !parsed.data.note) {
      return res.status(400).json({ success: false, error: 'Примечание обязательно при статусе «Не выполнено»' });
    }

    const currentStage = stage.rows[0];
    const nextStatus = parsed.data.status || currentStage.status;
    const nextNote = parsed.data.note !== undefined ? parsed.data.note : currentStage.note;
    const nextPlannedEnd = parsed.data.planned_end || toDateOnly(currentStage.planned_end);
    const nextActualEnd = parsed.data.actual_end || toDateOnly(currentStage.actual_end);
    const nextPlannedDate = parsed.data.planned_date || toDateOnly(currentStage.planned_date);
    const nextActualDate = parsed.data.actual_date || toDateOnly(currentStage.actual_date);
    const hasNote = Boolean(String(nextNote || '').trim());
    const isVolumeStage = currentStage.is_from_vor || Number(currentStage.planned_value) > 0;
    if (nextStatus === 'done' && isVolumeStage && !nextActualDate) {
      return res.status(400).json({ success: false, error: 'Для выполненной работы укажите фактическое окончание' });
    }
    if (nextStatus === 'done' && !isVolumeStage && !nextActualEnd) {
      return res.status(400).json({ success: false, error: 'Для завершённого этапа укажите фактическое окончание' });
    }
    if (isVolumeStage && nextPlannedDate && nextActualDate && nextActualDate > nextPlannedDate && !hasNote) {
      return res.status(400).json({ success: false, error: 'При просрочке укажите пояснение в примечании' });
    }
    if (!isVolumeStage && nextPlannedEnd && nextActualEnd && nextActualEnd > nextPlannedEnd && !hasNote) {
      return res.status(400).json({ success: false, error: 'При просрочке укажите пояснение в примечании' });
    }

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
       RETURNING id, name, status, order_num, planned_start, planned_end, actual_end,
                 is_from_vor, is_calendar_mobilization, vor_item_id, unit, planned_value, actual_value,
                 planned_date, actual_date, note, customer_agreed, created_at`,
      values
    );

    const statusChanged = parsed.data.status !== undefined && parsed.data.status !== stage.rows[0].status;

    if (statusChanged && parsed.data.status === 'not_done') {
      const customers = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1 AND role = $2`,
        [stage.rows[0].project_id, ROLES.CUSTOMER]
      );
      await Promise.all(customers.rows.map(c =>
        sendNotification({
          userId: c.user_id,
          projectId: stage.rows[0].project_id,
          type: 'status',
          entityType: 'stage',
          entityId: result.rows[0].id,
          message: `Требуется согласование по этапу: ${result.rows[0].name}`,
        })
      ));
    }

    if (statusChanged && parsed.data.status === 'done') {
      const members = await pool.query(
        `SELECT user_id FROM project_members WHERE project_id = $1`,
        [stage.rows[0].project_id]
      );
      await Promise.all(members.rows.map(m =>
        sendNotification({
          userId: m.user_id,
          projectId: stage.rows[0].project_id,
          type: 'status',
          entityType: 'stage',
          entityId: result.rows[0].id,
          message: `Этап «${result.rows[0].name}» завершён`,
        })
      ));
    }

    const updated = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...updated,
        planned_start: toDateOnly(updated.planned_start),
        planned_end: toDateOnly(updated.planned_end),
        actual_end: toDateOnly(updated.actual_end),
        planned_date: toDateOnly(updated.planned_date),
        actual_date: toDateOnly(updated.actual_date),
      },
    });
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

    const ext = getUploadFileExtension(req.file.originalname);
    const fileKey = `photos/${stage.rows[0].project_id}/${id}/${randomUUID()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
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
        userId: project.rows[0].manager_id,
        projectId: stage.rows[0].project_id,
        type: 'photo',
        entityType: 'stage',
        entityId: stage.rows[0].id,
        message: 'Прораб загрузил новое фото этапа',
      });
    }

    return res.status(201).json({ success: true, data: { ...result.rows[0], url: getProtectedDownloadUrl(fileKey) } });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/foreman/photos/:id
async function deletePhoto(req, res, next) {
  try {
    const { id } = req.params;

    const photo = await pool.query(
      `SELECT sp.id, sp.file_key, sp.uploaded_by, ps.project_id
       FROM stage_photos sp
       JOIN project_stages ps ON ps.id = sp.stage_id
       WHERE sp.id = $1 AND ps.is_deleted = FALSE`,
      [id]
    );
    if (!photo.rows[0]) return res.status(404).json({ success: false, error: 'Фото не найдено' });

    const isMember = await checkMembership(photo.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const isAdmin = req.session.userRole === ROLES.ADMIN;
    if (!isAdmin && photo.rows[0].uploaded_by !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Можно удалить только своё фото' });
    }

    await deleteStoredObject(photo.rows[0].file_key);
    await pool.query(
      `DELETE FROM stage_photos WHERE id = $1`,
      [id]
    );

    return res.json({ success: true });
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
      `SELECT stages_generated, kp_sent_at FROM projects WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!project.rows[0]) return res.status(404).json({ success: false, error: 'Проект не найден' });
    if (!project.rows[0].kp_sent_at) {
      return res.status(400).json({ success: false, error: 'Сначала менеджер должен отправить КП заказчику' });
    }
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
              (qty_total - qty_used) AS qty_balance, source, purchase_price, updated_at
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

// GET /api/foreman/stages/:id/writeoffs
async function getStageWriteoffs(req, res, next) {
  try {
    const { id } = req.params;
    const stage = await pool.query(
      `SELECT id, project_id
       FROM project_stages
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const result = await pool.query(
      `SELECT ww.id, ww.quantity, ww.created_at,
              wp.material_name, wp.unit,
              u.name AS written_off_by_name
       FROM warehouse_writeoffs ww
       JOIN warehouse_project wp ON wp.id = ww.warehouse_item_id
       LEFT JOIN users u ON u.id = ww.written_off_by
       WHERE ww.stage_id = $1
       ORDER BY ww.created_at DESC`,
      [id]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/foreman/stages/:id/photos
async function getStagePhotos(req, res, next) {
  try {
    const { id } = req.params;
    const stage = await pool.query(
      `SELECT id, project_id
       FROM project_stages
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const photos = await pool.query(
      `SELECT id, file_key, description, uploaded_at
       FROM stage_photos
       WHERE stage_id = $1
       ORDER BY uploaded_at DESC`,
      [id]
    );

    const withUrls = photos.rows.map((photo) => ({
      ...photo,
      url: getProtectedDownloadUrl(photo.file_key),
    }));

    return res.json({ success: true, data: withUrls });
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
    const { quantity, stage_id } = parsed.data;

    const item = await pool.query(
      `SELECT id, project_id, qty_total, qty_used
       FROM warehouse_project
       WHERE id = $1`,
      [id]
    );
    if (!item.rows[0]) return res.status(404).json({ success: false, error: 'Позиция склада не найдена' });

    const isMember = await checkMembership(item.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const stage = await pool.query(
      `SELECT id
       FROM project_stages
       WHERE id = $1 AND project_id = $2 AND is_deleted = FALSE`,
      [stage_id, item.rows[0].project_id]
    );
    if (!stage.rows[0]) return res.status(400).json({ success: false, error: 'Этап не найден в проекте' });

    const available = parseFloat(item.rows[0].qty_total) - parseFloat(item.rows[0].qty_used);
    if (quantity > available) {
      return res.status(400).json({ success: false, error: `Недостаточно на складе. Доступно: ${available}` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE warehouse_project
         SET qty_used = qty_used + $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, material_name, qty_total, qty_used`,
        [quantity, id]
      );

      await client.query(
        `INSERT INTO warehouse_writeoffs
         (warehouse_item_id, project_id, stage_id, quantity, written_off_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, item.rows[0].project_id, stage_id, quantity, req.session.userId]
      );

      await client.query('COMMIT');
      return res.json({ success: true, data: result.rows[0] });
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
      `SELECT user_id FROM project_members WHERE project_id = $1 AND role = $2`,
      [id, ROLES.SUPPLIER]
    );
    await Promise.all(suppliers.rows.map(s =>
      sendNotification({
        userId: s.user_id,
        projectId: parseInt(id),
        type: 'mtr',
        message: `Новая заявка МТР: ${material_name}`,
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
              COALESCE(ws.supplied_qty, 0) AS supplied_qty,
              GREATEST(ms.quantity - COALESCE(ws.supplied_qty, 0), 0) AS remaining_qty,
              u.name AS supplier_name
       FROM material_specs ms
       LEFT JOIN (
         SELECT spec_id, SUM(qty_total) AS supplied_qty
         FROM warehouse_project
         WHERE spec_id IS NOT NULL
         GROUP BY spec_id
       ) ws ON ws.spec_id = ms.id
       JOIN users u ON u.id = ms.supplier_id
       WHERE ms.project_id = $1
         AND ms.is_deleted = FALSE
         AND ms.status <> 'draft'
       ORDER BY CASE ms.status
                  WHEN 'pending_approval' THEN 1
                  WHEN 'approved' THEN 2
                  WHEN 'rejected' THEN 3
                  ELSE 4
                END,
                ms.created_at`,
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
      userId: spec.rows[0].supplier_id,
      projectId: spec.rows[0].project_id,
      type: 'mtr',
      message: `Позиция ведомости «${spec.rows[0].material_name}» согласована`,
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
      userId: spec.rows[0].supplier_id,
      projectId: spec.rows[0].project_id,
      type: 'mtr',
      message: `Позиция ведомости «${spec.rows[0].material_name}» отклонена: ${rejection_note}`,
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

    await notifyManagerAboutWorkSpecs(id);

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

    await notifyManagerAboutWorkSpecs(id);

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

    const readableDocTypes = getReadableProjectDocumentTypes(req.session.userRole);
    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              u.name AS uploaded_by_name
       FROM project_documents pd
       JOIN users u ON u.id = pd.uploaded_by
       WHERE pd.project_id = $1
         AND pd.doc_type = ANY($2::text[])
       ORDER BY pd.uploaded_at DESC`,
      [id, readableDocTypes]
    );
    const docs = result.rows.map((doc) => ({
      ...decorateProjectDocument(doc),
      file_name: normalizeStoredFileName(doc.file_name),
    }));
    return res.json({ success: true, data: docs });
  } catch (err) {
    return next(err);
  }
}

function fmtDate(value) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function progressPct(item) {
  if (item.status === 'done') return 100;
  const v = Number(item.actual_value);
  const p = Number(item.planned_value);
  if (p > 0) return Math.min(100, Math.round((v / p) * 100));
  return 0;
}

function statusRu(status) {
  return { pending: 'Запланировано', in_progress: 'В работе', done: 'Выполнено', planned: 'Запланировано', not_done: 'Не выполнено' }[status] || status;
}

async function exportCalendarPlan(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const [projectResult, payload] = await Promise.all([
      pool.query(
        `SELECT p.code, p.name, p.address, p.planned_start, p.planned_end, p.contract_signed_at,
                p.contact_name,
                u.name AS customer_name
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.role = 'customer'
         LEFT JOIN users u ON u.id = pm.user_id
         WHERE p.id = $1 AND p.is_deleted = FALSE
         LIMIT 1`,
        [id]
      ),
      getCalendarPlanPayload(id),
    ]);

    if (!payload) return res.status(404).json({ success: false, error: 'Проект не найден' });

    const proj = projectResult.rows[0] || {};
    const items = payload.items || [];
    const works = items.filter((i) => !i.is_calendar_mobilization);
    const mob = items.filter((i) => i.is_calendar_mobilization);
    const allRows = [...mob, ...works];

    const rows = allRows.map((item, idx) => {
      const isMob = item.is_calendar_mobilization;
      const pct = progressPct(item);
      const delay = (() => {
        if (!item.planned_end || item.status === 'done') return 0;
        const today = new Date().toISOString().slice(0, 10);
        if (today <= item.planned_end) return 0;
        const [py, pm, pd] = item.planned_end.split('-').map(Number);
        const [ty, tm, td] = today.split('-').map(Number);
        return Math.round((new Date(ty, tm - 1, td) - new Date(py, pm - 1, pd)) / 86400000);
      })();
      const isOverdue = delay > 0;

      return `
        <tr class="${isMob ? 'row-mob' : ''} ${isOverdue ? 'row-overdue' : ''} ${item.status === 'done' ? 'row-done' : ''}">
          <td class="col-num">${idx + 1}</td>
          <td class="col-name">${item.name || '—'}${isMob ? ' <span class="tag-mob">Мобилизация</span>' : ''}</td>
          <td class="col-date">${fmtDate(item.planned_start)}</td>
          <td class="col-date">${fmtDate(item.planned_end)}</td>
          <td class="col-date">${fmtDate(item.actual_end || item.actual_date)}</td>
          <td class="col-pct">
            <div class="progress-wrap">
              <div class="progress-bar" style="width:${pct}%"></div>
              <span>${pct}%</span>
            </div>
          </td>
          <td class="col-status">
            <span class="status-badge status-${item.status}">
              ${isOverdue ? `Просрочка +${delay} дн.` : statusRu(item.status)}
            </span>
          </td>
          <td class="col-note">${item.note || ''}</td>
        </tr>`;
    }).join('');

    const customer = proj.customer_name || proj.contact_name || '—';
    const today = fmtDate(new Date().toISOString().slice(0, 10));

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Календарный план — ${proj.name || id}</title>
<style>
  @page { size: A3 landscape; margin: 16mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; font-size: 10pt; color: #111; background: #fff; }

  /* Шапка */
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .doc-company { font-size: 11pt; font-weight: 700; color: #111; }
  .doc-company span { font-weight: 400; font-size: 9pt; color: #555; display: block; margin-top: 2px; }
  .doc-title { text-align: center; flex: 1; }
  .doc-title h1 { font-size: 14pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .doc-title p { font-size: 9pt; color: #555; margin-top: 3px; }
  .doc-meta-right { text-align: right; font-size: 9pt; color: #555; }

  /* Инфо-блок */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 20px; margin-bottom: 14px; padding: 10px 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: #fafafa; }
  .info-item { display: flex; flex-direction: column; gap: 2px; }
  .info-label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #888; }
  .info-value { font-size: 10pt; font-weight: 600; color: #111; }

  /* Таблица */
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #111; color: #fff; }
  thead th { padding: 7px 8px; text-align: left; font-size: 9pt; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
  tbody tr { border-bottom: 1px solid #e8e8e8; }
  tbody tr:hover { background: #f7f7f7; }
  tbody td { padding: 6px 8px; font-size: 9.5pt; vertical-align: middle; }

  /* Колонки */
  .col-num { width: 32px; text-align: center; color: #888; font-size: 8.5pt; }
  .col-name { min-width: 200px; font-weight: 600; }
  .col-date { width: 90px; white-space: nowrap; color: #333; }
  .col-pct { width: 90px; }
  .col-status { width: 120px; }
  .col-note { color: #555; font-size: 9pt; }

  /* Стили строк */
  .row-mob td { background: rgba(59,130,246,.06); }
  .row-mob .col-name { color: #1d4ed8; }
  .row-overdue td { background: rgba(239,68,68,.05); }
  .row-overdue .col-name { color: #b91c1c; }
  .row-done td { color: #888; }
  .row-done .col-name { text-decoration: line-through; color: #999; }

  /* Прогресс */
  .progress-wrap { position: relative; background: #eee; border-radius: 3px; height: 14px; overflow: hidden; }
  .progress-bar { position: absolute; top: 0; left: 0; height: 100%; background: linear-gradient(90deg, #c97c1a, #f5a623); border-radius: 3px; }
  .progress-wrap span { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 7.5pt; font-weight: 700; color: #111; }

  /* Статус */
  .status-badge { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 8.5pt; font-weight: 600; }
  .status-done     { background: #d1fae5; color: #065f46; }
  .status-in_progress { background: #fef3c7; color: #92400e; }
  .status-pending, .status-planned { background: #f3f4f6; color: #4b5563; }
  .status-not_done { background: #fee2e2; color: #991b1b; }

  /* Тэг мобилизация */
  .tag-mob { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 3px; background: #dbeafe; color: #1e40af; font-size: 7.5pt; font-weight: 600; vertical-align: middle; }

  /* Подписи */
  .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 32px; padding-top: 10px; border-top: 1px solid #d0d0d0; }
  .signature-item { display: flex; flex-direction: column; gap: 4px; }
  .signature-label { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: .04em; }
  .signature-line { border-bottom: 1px solid #555; height: 28px; }
  .signature-name { font-size: 8pt; color: #555; margin-top: 3px; }

  /* Футер */
  .doc-footer { margin-top: 14px; text-align: center; font-size: 8pt; color: #aaa; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<div class="no-print" style="padding:10px;background:#f0f0f0;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:12px;font-family:sans-serif;font-size:13px;">
  <strong>Предпросмотр документа</strong> — для сохранения в PDF нажмите
  <button onclick="window.print()" style="padding:5px 14px;background:#111;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">🖨 Печать / Сохранить как PDF</button>
  <span style="color:#666;">Рекомендуемый формат: A3 альбомная</span>
</div>

<div style="padding: 16px 20px;">

<div class="doc-header">
  <div class="doc-company">
    ЭнергоАтлант
    <span>Электромонтажные работы 0.4–110 кВ</span>
  </div>
  <div class="doc-title">
    <h1>Календарный план производства работ</h1>
    <p>Форма КППР — ${proj.code || id}</p>
  </div>
  <div class="doc-meta-right">
    Дата: ${today}<br>
    Горизонт: ${payload.duration_days} дней
  </div>
</div>

<div class="info-grid">
  <div class="info-item">
    <span class="info-label">Объект</span>
    <span class="info-value">${proj.name || '—'}</span>
  </div>
  <div class="info-item">
    <span class="info-label">Адрес</span>
    <span class="info-value">${proj.address || '—'}</span>
  </div>
  <div class="info-item">
    <span class="info-label">Заказчик</span>
    <span class="info-value">${customer}</span>
  </div>
  <div class="info-item">
    <span class="info-label">Начало работ</span>
    <span class="info-value">${fmtDate(payload.calendar_start)}</span>
  </div>
  <div class="info-item">
    <span class="info-label">Плановое окончание</span>
    <span class="info-value">${fmtDate(proj.planned_end)}</span>
  </div>
  <div class="info-item">
    <span class="info-label">Дата подписания договора</span>
    <span class="info-value">${fmtDate(proj.contract_signed_at)}</span>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th class="col-num">№</th>
      <th class="col-name">Наименование этапа работ</th>
      <th class="col-date">Плановое начало</th>
      <th class="col-date">Плановое окончание</th>
      <th class="col-date">Фактическое окончание</th>
      <th class="col-pct">Выполнение</th>
      <th class="col-status">Статус</th>
      <th class="col-note">Примечания</th>
    </tr>
  </thead>
  <tbody>
    ${rows || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888">Этапы не добавлены</td></tr>'}
  </tbody>
</table>

<div class="signatures">
  <div class="signature-item">
    <span class="signature-label">Прораб</span>
    <div class="signature-line"></div>
    <span class="signature-name">_________________________ / подпись</span>
  </div>
  <div class="signature-item">
    <span class="signature-label">Менеджер проекта</span>
    <div class="signature-line"></div>
    <span class="signature-name">_________________________ / подпись</span>
  </div>
  <div class="signature-item">
    <span class="signature-label">Заказчик</span>
    <div class="signature-line"></div>
    <span class="signature-name">_________________________ / подпись</span>
  </div>
</div>

<div class="doc-footer">ЭнергоАтлант · Москва и МО · +7 (993) 907-45-77 · energoatlant@yandex.ru</div>

</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getProjects,
  joinProject,
  getProject,
  getCalendarPlan,
  generateCalendarPlan,
  updateCalendarPlanItem,
  getStages,
  createStage,
  updateStage,
  generateStagesFromVOR,
  uploadPhoto,
  deletePhoto,
  getWarehouse,
  getStageWriteoffs,
  getStagePhotos,
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
  exportCalendarPlan,
};
