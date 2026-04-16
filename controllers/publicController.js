const { z } = require('zod');
const { pool } = require('../config/database');

const requestSchema = z.object({
  name:    z.string().min(1).max(100).optional(),
  phone:   z.string().max(20).optional(),
  email:   z.string().email().optional(),
  message: z.string().max(2000).optional(),
});

async function createRequest(req, res, next) {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, phone, email, message } = parsed.data;

    if (!phone && !email) {
      return res.status(400).json({ success: false, error: 'Укажите телефон или email' });
    }

    const result = await pool.query(
      `INSERT INTO public_requests (name, phone, email, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [name || null, phone || null, email || null, message || null]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createRequest };
