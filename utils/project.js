const { pool } = require('../config/database');
const { ROLES } = require('./constants');

/**
 * Проверяет доступ пользователя к проекту: участник проекта или админ.
 * @param {number|string} projectId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function checkMembership(projectId, userId) {
  const result = await pool.query(
    `SELECT 1
     FROM users u
     WHERE u.id = $2
       AND u.is_deleted = FALSE
       AND (
         u.role = $3
         OR EXISTS (
           SELECT 1
           FROM project_members pm
           WHERE pm.project_id = $1
             AND pm.user_id = u.id
         )
       )`,
    [projectId, userId, ROLES.ADMIN]
  );
  return result.rows.length > 0;
}

/**
 * Фабрика: возвращает обработчик POST /projects/join для заданной роли.
 * @param {string} role  — значение из ROLES
 * @returns {Function}   — Express route handler
 */
function makeJoinProject(role) {
  return async function joinProject(req, res, next) {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ success: false, error: 'Укажите код проекта' });
      }

      const project = await pool.query(
        `SELECT id, name FROM projects WHERE code = $1 AND is_deleted = FALSE`,
        [code.trim().toUpperCase()]
      );

      if (!project.rows[0]) {
        return res.status(404).json({ success: false, error: 'Проект не найден' });
      }

      const { id, name } = project.rows[0];

      await pool.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [id, req.session.userId, role]
      );

      return res.json({ success: true, data: { id, name } });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { checkMembership, makeJoinProject };
