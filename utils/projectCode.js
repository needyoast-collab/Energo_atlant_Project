const { pool } = require('../config/database');

async function generateProjectCode() {
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;

  const result = await pool.query(
    `SELECT code FROM projects WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let next = 1;
  if (result.rows.length > 0) {
    const last = result.rows[0].code.replace(prefix, '');
    next = parseInt(last, 10) + 1;
  }

  return `${prefix}${String(next).padStart(4, '0')}`;
}

module.exports = { generateProjectCode };
