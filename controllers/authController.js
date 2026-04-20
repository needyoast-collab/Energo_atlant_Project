const argon2 = require('argon2');
const { pool } = require('../config/database');
const { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } = require('../utils/validate');
const { sendSms } = require('../utils/sms');
const { sendMail } = require('../utils/email');

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, email, login: userLogin, phone, password, role } = parsed.data;

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR login = $2 OR phone = $3',
      [email, userLogin, phone]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email, Логин или Телефон уже используется' });
    }

    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    const result = await pool.query(
      `INSERT INTO users (role, name, email, login, phone, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, role, name, email, is_verified, created_at`,
      [role, name, email, userLogin, phone, password_hash]
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

    const { identifier, password } = parsed.data;

    const result = await pool.query(
      `SELECT id, role, name, email, password_hash, is_verified, is_deleted
       FROM users WHERE email = $1 OR login = $1 OR phone = $1`,
      [identifier]
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

    req.session.userId   = user.id;
    req.session.userRole = user.role;

    return res.json({
      success: true,
      data: {
        id:    user.id,
        role:  user.role,
        name:  user.name,
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
      `SELECT id, role, name, email, phone, login, is_verified, created_at
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

// ─── СБРОС ПАРОЛЯ ─────────────────────────────────────────────────────────────

async function forgotPassword(req, res, next) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Укажите email, логин или телефон' });
    
    const { identifier } = parsed.data;

    const result = await pool.query(
      `SELECT id, email, phone FROM users WHERE email = $1 OR login = $1 OR phone = $1`,
      [identifier]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь с такими данными не найден' });
    }

    // Генерируем 6-значный код
    const code = '123456'; // ВРЕМЕННАЯ ЗАГЛУШКА ДЛЯ ТЕСТОВ
    // const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 минут

    await pool.query(
      `UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3`,
      [code, expiresAt, user.id]
    );

    // Предпочитаем отправлять СМС, если ввели телефон
    let sent = false;
    if (identifier === user.phone && user.phone) {
      sent = await sendSms(user.phone, `Код сброса пароля ЭнергоАтлант: ${code}`);
    } else {
      sent = await sendMail(user.email, 'Восстановление пароля', `Ваш код для сброса пароля: ${code}\nДействует 15 минут.`);
    }

    return res.json({ success: true, message: 'Код отправлен' });
  } catch(err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    
    const { identifier, code, newPassword } = parsed.data;

    const result = await pool.query(
      `SELECT id, reset_code, reset_expires FROM users 
       WHERE email = $1 OR login = $1 OR phone = $1`,
      [identifier]
    );
    const user = result.rows[0];

    if (!user || user.reset_code !== code || new Date() > new Date(user.reset_expires)) {
      return res.status(400).json({ success: false, error: 'Неверный или просроченный код' });
    }

    const password_hash = await argon2.hash(newPassword, { type: argon2.argon2id });

    // Очищаем код профиля и ставим новый пароль
    await pool.query(
      `UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2`,
      [password_hash, user.id]
    );

    return res.json({ success: true, message: 'Пароль успешно изменён' });
  } catch(err) {
    return next(err);
  }
}

module.exports = { register, login, logout, me, forgotPassword, resetPassword };
