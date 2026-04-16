const { randomUUID } = require('crypto');
const { pool } = require('../config/database');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { ROLES } = require('../middleware/auth');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { createRequestSchema } = require('../utils/validate');

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

    const { message, phone, doc_type } = parsed.data;
    const { name, email } = user.rows[0];

    let fileKey = null;

    if (req.file) {
      const ext = req.file.originalname.split('.').pop().toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        return res.status(400).json({ success: false, error: 'Недопустимый формат файла' });
      }
      fileKey = `requests/${Date.now()}_${randomUUID()}.${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         fileKey,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype,
      }));
    }

    const result = await pool.query(
      `INSERT INTO public_requests (name, phone, email, message, doc_type, file_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [name, phone || null, email, message, doc_type || null, fileKey]
    );

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
      `SELECT id, material_name, unit, qty_planned, qty_received, qty_used
       FROM warehouse_items
       WHERE project_id = $1
       ORDER BY material_name`,
      [id]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getProjects, createRequest, joinProject, getProject, getStages, getDocuments, getWarehouse };
