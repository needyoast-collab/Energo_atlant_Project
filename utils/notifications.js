const { pool } = require('../config/database');

async function sendNotification({ userId, projectId = null, type, message }) {
  await pool.query(
    `INSERT INTO notifications (user_id, project_id, type, message)
     VALUES ($1, $2, $3, $4)`,
    [userId, projectId, type, message]
  );
}

module.exports = { sendNotification };
