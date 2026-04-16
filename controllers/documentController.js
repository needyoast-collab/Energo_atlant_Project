const { pool } = require('../config/database');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { ROLES } = require('../middleware/auth');

// GET /api/documents/serve/:key
// key передаётся как base64url чтобы не ломать слэши в пути YOS
async function serveDocument(req, res, next) {
  try {
    const fileKey = Buffer.from(req.params.key, 'base64url').toString('utf8');

    // Проверка: пользователь имеет доступ к этому файлу
    const [photo, docMember, docManager] = await Promise.all([
      pool.query(
        `SELECT sp.stage_id FROM stage_photos sp
         JOIN project_stages ps ON ps.id = sp.stage_id
         JOIN project_members pm ON pm.project_id = ps.project_id
         WHERE sp.file_key = $1 AND pm.user_id = $2
         LIMIT 1`,
        [fileKey, req.session.userId]
      ),
      pool.query(
        `SELECT pd.id FROM project_documents pd
         JOIN project_members pm ON pm.project_id = pd.project_id
         WHERE pd.file_key = $1 AND pm.user_id = $2
         LIMIT 1`,
        [fileKey, req.session.userId]
      ),
      pool.query(
        `SELECT pd.id FROM project_documents pd
         JOIN projects p ON p.id = pd.project_id
         WHERE pd.file_key = $1 AND p.manager_id = $2
         LIMIT 1`,
        [fileKey, req.session.userId]
      ),
    ]);

    const isAdmin = req.session.userRole === ROLES.ADMIN;
    const hasAccess = isAdmin || photo.rows.length > 0 || docMember.rows.length > 0 || docManager.rows.length > 0;

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
