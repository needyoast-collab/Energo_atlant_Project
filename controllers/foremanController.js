const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { getCalendarPlanPayload } = require('../utils/calendarPlan');
const { getUploadFileExtension, normalizeStoredFileName } = require('../utils/fileNames');
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

    const signedUrl = await getSignedDownloadUrl(fileKey);
    return res.status(201).json({ success: true, data: { ...result.rows[0], url: signedUrl } });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/foreman/photos/:id
async function deletePhoto(req, res, next) {
  try {
    const { id } = req.params;

    const photo = await pool.query(
      `SELECT sp.id, sp.file_key, ps.project_id
       FROM stage_photos sp
       JOIN project_stages ps ON ps.id = sp.stage_id
       WHERE sp.id = $1 AND ps.is_deleted = FALSE`,
      [id]
    );
    if (!photo.rows[0]) return res.status(404).json({ success: false, error: 'Фото не найдено' });

    const isMember = await checkMembership(photo.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    if (s3) {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: photo.rows[0].file_key,
      }));
    }

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

    const withUrls = await Promise.all(photos.rows.map(async (photo) => ({
      ...photo,
      url: await getSignedDownloadUrl(photo.file_key),
    })));

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
};
