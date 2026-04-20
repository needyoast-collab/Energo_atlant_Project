const { randomUUID } = require('crypto');
const { pool } = require('../config/database');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { ROLES } = require('../middleware/auth');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { createRequestSchema } = require('../utils/validate');
const { sendNotification } = require('../utils/notifications');

const ALLOWED_EXTS = ['pdf', 'dwg', 'doc', 'docx', 'xls', 'xlsx'];

// GET /api/customer/projects
async function getProjects(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.contract_value, p.created_at,
              u.name AS manager_name,
              COALESCE(st.total, 0)       AS stage_total,
              COALESCE(st.done, 0)        AS stage_done,
              COALESCE(ph.photo_count, 0) AS photo_count,
              COALESCE(dc.doc_count, 0)   AS doc_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       LEFT JOIN users u ON u.id = p.manager_id
       LEFT JOIN (
         SELECT project_id,
                COUNT(*)                                    AS total,
                COUNT(*) FILTER (WHERE status = 'done')    AS done
         FROM project_stages WHERE is_deleted = FALSE
         GROUP BY project_id
       ) st ON st.project_id = p.id
       LEFT JOIN (
         SELECT ps.project_id, COUNT(sp.id) AS photo_count
         FROM project_stages ps
         JOIN stage_photos sp ON sp.stage_id = ps.id
         WHERE ps.is_deleted = FALSE
         GROUP BY ps.project_id
       ) ph ON ph.project_id = p.id
       LEFT JOIN (
         SELECT project_id, COUNT(*) AS doc_count
         FROM project_documents
         GROUP BY project_id
       ) dc ON dc.project_id = p.id
       WHERE pm.user_id = $1 AND pm.role = 'customer' AND p.is_deleted = FALSE
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/customer/requests
async function createRequest(req, res, next) {
  try {
    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const user = await pool.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [req.session.userId]
    );

    const { message, phone } = parsed.data;
    const { name, email } = user.rows[0];

    const result = await pool.query(
      `INSERT INTO public_requests (name, phone, email, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [name, phone || null, email, message || null]
    );
    const requestId = result.rows[0].id;

    const files = req.files || [];
    if (files.length > 0) {
      if (!s3) {
        console.warn('[STORAGE] S3 не настроен — файлы не будут сохранены');
      } else {
        const rawDocTypes = req.body.doc_types;
        const docTypes = Array.isArray(rawDocTypes)
          ? rawDocTypes
          : rawDocTypes ? [rawDocTypes] : [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const ext = file.originalname.split('.').pop().toLowerCase();
          if (!ALLOWED_EXTS.includes(ext)) continue;
          const fileKey = `requests/${requestId}/${randomUUID()}.${ext}`;
          await s3.send(new PutObjectCommand({
            Bucket:      BUCKET,
            Key:         fileKey,
            Body:        file.buffer,
            ContentType: file.mimetype,
          }));
          await pool.query(
            `INSERT INTO public_request_files (request_id, file_key, file_name, doc_type)
             VALUES ($1, $2, $3, $4)`,
            [requestId, fileKey, file.originalname, docTypes[i] || null]
          );
        }
      }
    }

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/customer/projects/join
const joinProject = makeJoinProject(ROLES.CUSTOMER);

// GET /api/customer/projects/:id
async function getProject(req, res, next) {
  try {
    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.description, p.address, p.contract_value, p.created_at,
              u.name as manager_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE p.id = $1 AND p.is_deleted = FALSE`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/customer/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const stages = await pool.query(
      `SELECT ps.id, ps.name, ps.status, ps.order_num, ps.planned_start, ps.planned_end, ps.actual_end,
              ps.is_from_vor, ps.unit, ps.planned_value, ps.actual_value,
              ps.planned_date, ps.actual_date, ps.note, ps.customer_agreed,
              COUNT(sp.id) as photo_count
       FROM project_stages ps
       LEFT JOIN stage_photos sp ON sp.stage_id = ps.id
       WHERE ps.project_id = $1 AND ps.is_deleted = FALSE
       GROUP BY ps.id
       ORDER BY ps.order_num, ps.created_at`,
      [id]
    );

    return res.json({ success: true, data: stages.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/customer/projects/:id/documents
async function getDocuments(req, res, next) {
  try {
    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              u.name as uploaded_by_name
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

// GET /api/customer/projects/:id/warehouse
async function getWarehouse(req, res, next) {
  try {
    const { id } = req.params;
    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const result = await pool.query(
      `SELECT id, material_name, unit, qty_total, qty_used,
              (qty_total - qty_used) AS qty_balance
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

// GET /api/customer/stages/:stageId/photos
async function getStagePhotos(req, res, next) {
  try {
    const { stageId } = req.params;

    const stage = await pool.query(
      `SELECT project_id FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [stageId]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });

    const isMember = await checkMembership(stage.rows[0].project_id, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа' });

    const photos = await pool.query(
      `SELECT id, file_key, description, uploaded_at
       FROM stage_photos WHERE stage_id = $1 ORDER BY uploaded_at`,
      [stageId]
    );

    const result = await Promise.all(photos.rows.map(async p => ({
      ...p,
      url: await getSignedDownloadUrl(p.file_key),
    })));

    return res.json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/customer/projects/:projectId/stages/:stageId/approve
async function approveStage(req, res, next) {
  try {
    const { projectId, stageId } = req.params;
    const isMember = await checkMembership(projectId, req.session.userId);
    if (!isMember) return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });

    const stage = await pool.query(
      `SELECT id, name, status FROM project_stages WHERE id = $1 AND is_deleted = FALSE`,
      [stageId]
    );
    if (!stage.rows[0]) return res.status(404).json({ success: false, error: 'Этап не найден' });
    if (stage.rows[0].status !== 'not_done') {
      return res.status(400).json({ success: false, error: 'Этап не требует согласования' });
    }

    await pool.query(
      `UPDATE project_stages SET customer_agreed = TRUE WHERE id = $1`,
      [stageId]
    );

    const foremans = await pool.query(
      `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'foreman'`,
      [projectId]
    );
    await Promise.all(foremans.rows.map(f =>
      sendNotification({
        userId:    f.user_id,
        projectId: parseInt(projectId),
        type:      'status',
        message:   `Заказчик согласовал этап: «${stage.rows[0].name}»`,
      })
    ));

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getProjects, createRequest, joinProject, getProject, getStages, getStagePhotos, getDocuments, getWarehouse, approveStage };
