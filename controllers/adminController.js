const argon2 = require('argon2');
const { pool } = require('../config/database');
const { createUserSchema, updateUserSchema, updatePayoutSchema } = require('../utils/validate');

// GET /api/admin/users
async function getUsers(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, role, name, email, is_verified, is_deleted, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/users
async function createUser(req, res, next) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, email, password, role } = parsed.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email уже занят' });
    }

    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    const result = await pool.query(
      `INSERT INTO users (role, name, email, password_hash, is_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, role, name, email, is_verified, created_at`,
      [role, name, email, password_hash]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/admin/users/:id
async function updateUser(req, res, next) {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, email, role } = parsed.data;
    const { id } = req.params;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name)  { fields.push(`name = $${idx++}`);  values.push(name); }
    if (email) { fields.push(`email = $${idx++}`); values.push(email); }
    if (role)  { fields.push(`role = $${idx++}`);  values.push(role); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx} AND is_deleted = FALSE
       RETURNING id, role, name, email, is_verified, created_at`,
      values
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/admin/users/:id  (soft delete)
async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ success: false, error: 'Нельзя удалить себя' });
    }

    const result = await pool.query(
      `UPDATE users SET is_deleted = TRUE
       WHERE id = $1 AND is_deleted = FALSE
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/users/:id/verify
async function verifyUser(req, res, next) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE users SET is_verified = TRUE
       WHERE id = $1 AND is_deleted = FALSE
       RETURNING id, role, name, email, is_verified`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// POST /api/admin/users/:id/restore
async function restoreUser(req, res, next) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE users SET is_deleted = FALSE
       WHERE id = $1
       RETURNING id, role, name, email, is_verified`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/admin/metrics
async function getMetrics(req, res, next) {
  try {
    const [users, projects, requests, payouts] = await Promise.all([
      pool.query(`SELECT role, COUNT(*) as count FROM users WHERE is_deleted = FALSE GROUP BY role`),
      pool.query(`SELECT status, COUNT(*) as count FROM projects WHERE is_deleted = FALSE GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) as count FROM public_requests WHERE is_deleted = FALSE GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) as count, SUM(amount) as total FROM partner_payouts GROUP BY status`),
    ]);

    return res.json({
      success: true,
      data: {
        users:    users.rows,
        projects: projects.rows,
        requests: requests.rows,
        payouts:  payouts.rows,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/admin/partner-payouts
async function getPartnerPayouts(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT pp.id, pp.amount, pp.payment_details, pp.status, pp.processed_at, pp.created_at,
              u.id as partner_id, u.name as partner_name, u.email as partner_email
       FROM partner_payouts pp
       JOIN users u ON u.id = pp.partner_id
       ORDER BY pp.created_at DESC`
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// PUT /api/admin/partner-payouts/:id
async function updatePartnerPayout(req, res, next) {
  try {
    const parsed = updatePayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { status } = parsed.data;
    const { id } = req.params;

    const processed_at = ['paid', 'rejected'].includes(status) ? new Date() : null;

    const result = await pool.query(
      `UPDATE partner_payouts
       SET status = $1, processed_at = $2
       WHERE id = $3
       RETURNING id, status, processed_at`,
      [status, processed_at, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Выплата не найдена' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  verifyUser,
  restoreUser,
  getMetrics,
  getPartnerPayouts,
  updatePartnerPayout,
};
