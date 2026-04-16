const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { z } = require('zod');

const ALLOWED_SENDER_ROLES = ['admin', 'manager', 'customer'];

const sendSchema = z.object({
  receiver_id: z.number().int().positive(),
  project_id:  z.number().int().positive().optional(),
  subject:     z.string().max(200).optional(),
  body:        z.string().min(1).max(5000),
});

// GET /api/messages
async function getMessages(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT m.id, m.subject, m.body, m.is_read, m.created_at,
              m.project_id,
              s.id as sender_id, s.name as sender_name, s.role as sender_role,
              r.id as receiver_id, r.name as receiver_name
       FROM messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.receiver_id
       WHERE m.sender_id = $1 OR m.receiver_id = $1
       ORDER BY m.created_at DESC`,
      [req.session.userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/messages
async function sendMessage(req, res, next) {
  try {
    if (!ALLOWED_SENDER_ROLES.includes(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Отправка сообщений недоступна для вашей роли' });
    }

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { receiver_id, project_id, subject, body } = parsed.data;

    const receiver = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [receiver_id]
    );
    if (!receiver.rows[0]) {
      return res.status(404).json({ success: false, error: 'Получатель не найден' });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, project_id, subject, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, subject, body, is_read, created_at`,
      [req.session.userId, receiver_id, project_id || null, subject || null, body]
    );

    await sendNotification({
      userId:    receiver_id,
      projectId: project_id || null,
      type:      'message',
      message:   `Новое сообщение${subject ? `: ${subject}` : ''}`,
    });

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/messages/find-user?email=...
async function findUser(req, res, next) {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'Укажите email' });

    const result = await pool.query(
      `SELECT id, name, role FROM users WHERE email = $1 AND is_deleted = FALSE AND is_verified = TRUE`,
      [email.toLowerCase()]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, data: null, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMessages, sendMessage, findUser };
