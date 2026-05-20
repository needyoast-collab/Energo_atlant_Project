const { randomUUID } = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('../config/database');
const { s3, BUCKET } = require('../config/storage');
const { sendNotification } = require('../utils/notifications');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const {
  ROLES,
  PROJECT_DOCUMENT_TYPES,
  PROJECT_DOCUMENT_LABELS,
  getReadableProjectDocumentTypes,
  normalizeProjectDocumentType,
  decorateProjectDocument,
} = require('../utils/constants');
const {
  isAdminSession,
  logProjectHistory,
  getManagerProject,
  ensureManagerProjectAccess,
} = require('../utils/managerProject');
const {
  getUploadFileExtension,
  normalizeStoredFileName,
  normalizeUploadFileName,
} = require('../utils/fileNames');
const { managerUploadDocSchema } = require('../utils/validate');

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
    const originalFileName = normalizeUploadFileName(req.file.originalname);
    const ext = getUploadFileExtension(originalFileName);
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
      [id, req.session.userId, doc_type, fileKey, originalFileName, description || null]
    );

    await logProjectHistory({
      projectId: parseInt(id, 10),
      changedBy: req.session.userId,
      action: 'upload_document',
      fieldName: 'doc_type',
      newValue: doc_type,
      details: `Загружен документ ${originalFileName}`,
    });

    const members = await pool.query(
      `SELECT user_id FROM project_members WHERE project_id = $1 AND role = $2`,
      [id, ROLES.CUSTOMER]
    );
    members.rows.forEach(r => sendNotification({
      userId:    r.user_id,
      projectId: parseInt(id),
      type:      'document',
      entityType: 'document',
      entityId:   result.rows[0].id,
      message:   `Загружен новый документ: ${originalFileName}`,
    }));

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

    const readableDocTypes = getReadableProjectDocumentTypes(req.session.userRole);
    const result = await pool.query(
      `SELECT pd.id, pd.doc_type, pd.file_key, pd.file_name, pd.description, pd.uploaded_at,
              u.name as uploaded_by_name, u.id as uploaded_by_id
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
      file_name: normalizeStoredFileName(f.file_name),
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

    const files = await pool.query(
      `SELECT file_key, file_name, doc_type FROM public_request_files WHERE request_id = $1`,
      [request_id]
    );

    await Promise.all(files.rows.map(f => pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        req.session.userId,
        PROJECT_DOCUMENT_TYPES.includes(normalizeProjectDocumentType(f.doc_type))
          ? normalizeProjectDocumentType(f.doc_type)
          : 'other',
        f.file_key,
        normalizeStoredFileName(f.file_name),
      ]
    )));

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// GET /api/manager/doc-types
function getDocTypes(req, res) {
  return res.json({ success: true, data: PROJECT_DOCUMENT_LABELS });
}

module.exports = {
  uploadDocument,
  getDocuments,
  deleteDocument,
  getRequestFiles,
  copyRequestFiles,
  getDocTypes,
};
