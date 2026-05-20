const { pool } = require('../config/database');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { ROLES, canReadProjectDocumentType } = require('../utils/constants');

// GET /api/documents/serve/:key
// key передаётся как base64url чтобы не ломать слэши в пути YOS
async function serveDocument(req, res, next) {
  try {
    const fileKey = Buffer.from(req.params.key, 'base64url').toString('utf8');

    // Проверка: пользователь имеет доступ к этому файлу
    const [photo, docAccess] = await Promise.all([
      pool.query(
        `SELECT sp.stage_id,
                (pm.user_id IS NOT NULL) AS is_project_member
         FROM stage_photos sp
         JOIN project_stages ps ON ps.id = sp.stage_id
         LEFT JOIN project_members pm
           ON pm.project_id = ps.project_id
          AND pm.user_id = $2
         WHERE sp.file_key = $1
         LIMIT 1`,
        [fileKey, req.session.userId]
      ),
      pool.query(
        `SELECT pd.id,
                pd.doc_type,
                p.manager_id,
                (pm.user_id IS NOT NULL) AS is_project_member
         FROM project_documents pd
         LEFT JOIN project_members pm
           ON pm.project_id = pd.project_id
          AND pm.user_id = $2
         LEFT JOIN projects p
           ON p.id = pd.project_id
         WHERE pd.file_key = $1
         LIMIT 1`,
        [fileKey, req.session.userId]
      ),
    ]);

    const isAdmin = req.session.userRole === ROLES.ADMIN;
    const stagePhoto = photo.rows[0];
    const doc = docAccess.rows[0];
    const hasPhotoAccess = Boolean(stagePhoto) && (isAdmin || stagePhoto.is_project_member);
    const hasDocumentAccess = Boolean(doc)
      && canReadProjectDocumentType(req.session.userRole, doc.doc_type)
      && (isAdmin || doc.is_project_member || doc.manager_id === req.session.userId);
    const hasAccess = hasPhotoAccess || hasDocumentAccess;

    if (!hasAccess) {
      return res.status(403).json({ success: false, error: 'Нет доступа к файлу' });
    }

    const url = await getSignedDownloadUrl(fileKey);
    return res.redirect(302, url);
  } catch (err) {
    return next(err);
  }
}

module.exports = { serveDocument };
