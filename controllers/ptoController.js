const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { ROLES } = require('../middleware/auth');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { uploadDocSchema } = require('../utils/validate');

const DOC_LABELS = {
  hidden_works_act:    'Акт скрытых работ',
  exec_scheme:         'Исполнительная схема',
  geodetic_survey:     'Геодезическая съёмка',
  general_works_log:   'Общий журнал работ',
  author_supervision:  'Журнал авторского надзора',
  interim_acceptance:  'Акт промежуточной приёмки',
  cable_test_act:      'Акт испытания КЛ',
  measurement_protocol:'Протокол измерений',
  other:               'Прочее',
};

// GET /api/pto/projects
async function getProjects(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.created_at,
              u.name as manager_name
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       LEFT JOIN users u ON u.id = p.manager_id
       WHERE pm.user_id = $1 AND pm.role = 'pto' AND p.is_deleted = FALSE
       ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/pto/doc-types
function getDocTypes(req, res) {
  return res.json({ success: true, data: DOC_LABELS });
}

// POST /api/pto/projects/join
const joinProject = makeJoinProject(ROLES.PTO);

// GET /api/pto/projects/:id
async function getProject(req, res, next) {
  try {
    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.description, p.address, p.created_at,
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

// GET /api/pto/projects/:id/stages
async function getStages(req, res, next) {
  try {
    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

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

// POST /api/pto/projects/:id/documents
async function uploadDocument(req, res, next) {
  try {
    const parsed = uploadDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    const { id } = req.params;

    const isMember = await checkMembership(id, req.session.userId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    }

    const { doc_type, description } = parsed.data;

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const fileKey = `documents/${id}/${doc_type}/${randomUUID()}.${ext}`;

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

    // Уведомить менеджера и заказчиков проекта
    const notify = await pool.query(
      `SELECT u.id FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.role IN ('manager','customer')`,
      [id]
    );

    const project = await pool.query(
      `SELECT manager_id FROM projects WHERE id = $1`,
      [id]
    );

    const toNotify = new Set(notify.rows.map(r => r.id));
    if (project.rows[0]?.manager_id) toNotify.add(project.rows[0].manager_id);

    await Promise.all([...toNotify].map(uid =>
      sendNotification({
        userId:    uid,
        projectId: parseInt(id),
        type:      'document',
        message:   `Загружен новый документ ИД: ${doc_type}`,
      })
    ));

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/pto/projects/:id/documents
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

// DELETE /api/pto/documents/:id
async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;

    const doc = await pool.query(
      `SELECT project_id, file_key, uploaded_by FROM project_documents WHERE id = $1`,
      [id]
    );

    if (!doc.rows[0]) {
      return res.status(404).json({ success: false, error: 'Документ не найден' });
    }

    // Удалять может только тот, кто загрузил, или admin
    if (doc.rows[0].uploaded_by !== req.session.userId && req.session.userRole !== ROLES.ADMIN) {
      return res.status(403).json({ success: false, error: 'Нет доступа' });
    }

    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key:    doc.rows[0].file_key,
    }));

    await pool.query(`DELETE FROM project_documents WHERE id = $1`, [id]);

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getProjects, getDocTypes, joinProject, getProject, getStages, uploadDocument, getDocuments, deleteDocument };
