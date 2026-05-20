const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const { checkMembership, makeJoinProject } = require('../utils/project');
const { uploadDocSchema } = require('../utils/validate');
const {
  ROLES,
  EXECUTIVE_DOCUMENT_TYPES,
  PROJECT_DOCUMENT_LABELS,
  getReadableProjectDocumentTypes,
  decorateProjectDocument,
} = require('../utils/constants');
const {
  getUploadFileExtension,
  normalizeStoredFileName,
  normalizeUploadFileName,
} = require('../utils/fileNames');

const DOC_LABELS = Object.fromEntries(
  EXECUTIVE_DOCUMENT_TYPES.map((docType) => [docType, PROJECT_DOCUMENT_LABELS[docType]])
);

// GET /api/pto/projects
async function getProjects(req, res, next) {
  try {
    const isAdmin = req.session.userRole === ROLES.ADMIN;
    const accessJoin = isAdmin ? '' : 'JOIN project_members pm ON pm.project_id = p.id';
    const accessWhere = isAdmin ? '' : 'AND pm.user_id = $1 AND pm.role = $2';
    const values = isAdmin ? [] : [req.session.userId, ROLES.PTO];
    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.created_at,
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

    const originalFileName = normalizeUploadFileName(req.file.originalname);
    const ext = getUploadFileExtension(originalFileName);
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
      [id, req.session.userId, doc_type, fileKey, originalFileName, description || null]
    );

    // Уведомить менеджера и заказчиков проекта
    const notify = await pool.query(
      `SELECT u.id FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.role = ANY($2::text[])`,
      [id, [ROLES.MANAGER, ROLES.CUSTOMER]]
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
        entityType: 'document',
        entityId:   result.rows[0].id,
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

    const readableDocTypes = getReadableProjectDocumentTypes(req.session.userRole);
    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              pd.uploaded_by as uploaded_by_id, u.name as uploaded_by_name
       FROM project_documents pd
       JOIN users u ON u.id = pd.uploaded_by
       WHERE pd.project_id = $1
         AND pd.doc_type = ANY($2::text[])
       ORDER BY pd.uploaded_at DESC`,
      [id, readableDocTypes]
    );

    const docs = await Promise.all(result.rows.map(async doc => ({
      ...decorateProjectDocument(doc),
      file_name: normalizeStoredFileName(doc.file_name),
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
