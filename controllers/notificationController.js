const { pool } = require('../config/database');

// GET /api/notifications
async function getNotifications(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, project_id, type, message, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.session.userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/notifications/:id/read
async function markRead(req, res, next) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_read`,
      [id, req.session.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Уведомление не найдено' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/notifications/read-all
async function markAllAsRead(req, res, next) {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1`,
      [req.session.userId]
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getNotifications, markRead, markAllAsRead };
