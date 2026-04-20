const argon2 = require('argon2');
const { pool } = require('../config/database');
const { registerSchema, loginSchema } = require('../utils/validate');

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, email, password, role } = parsed.data;

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email уже занят' });
    }

    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    const result = await pool.query(
      `INSERT INTO users (role, name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, role, name, email, is_verified, created_at`,
      [role, name, email, password_hash]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { email, password } = parsed.data;

    const result = await pool.query(
      `SELECT id, role, name, email, password_hash, is_verified, is_deleted
       FROM users WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return res.status(401).json({ success: false, error: 'Неверный email или пароль' });
    }

    if (user.is_deleted) {
      return res.status(403).json({ success: false, error: 'Аккаунт удалён' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ success: false, error: 'Аккаунт ожидает верификации администратором' });
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;

    return res.json({
      success: true,
      data: {
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid');
      return res.json({ success: true });
    });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, role, name, email, is_verified, created_at
       FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [req.session.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, logout, me };
