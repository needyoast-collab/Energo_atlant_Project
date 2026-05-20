const { pool } = require('../config/database');
const { ROLES } = require('./constants');

function isAdminSession(req) {
  return req.session.userRole === ROLES.ADMIN;
}

function formatHistoryValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function logProjectHistory({
  projectId,
  changedBy,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  details = null,
}) {
  await pool.query(
    `INSERT INTO project_history
      (project_id, changed_by, action, field_name, old_value, new_value, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      projectId,
      changedBy || null,
      action,
      fieldName,
      formatHistoryValue(oldValue),
      formatHistoryValue(newValue),
      details,
    ]
  );
}

async function getManagerProject(projectId, req) {
  const values = [projectId];
  let where = 'p.id = $1 AND p.is_deleted = FALSE';

  if (!isAdminSession(req)) {
    values.push(req.session.userId);
    where += ' AND p.manager_id = $2';
  }

  const result = await pool.query(
    `SELECT p.id, p.manager_id
     FROM projects p
     WHERE ${where}`,
    values
  );
  return result.rows[0] || null;
}

async function ensureManagerProjectAccess(projectId, req, res) {
  const project = await getManagerProject(projectId, req);
  if (!project) {
    res.status(403).json({ success: false, error: 'Нет доступа к проекту' });
    return null;
  }
  return project;
}

module.exports = {
  isAdminSession,
  formatHistoryValue,
  logProjectHistory,
  getManagerProject,
  ensureManagerProjectAccess,
};
