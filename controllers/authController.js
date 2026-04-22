const argon2 = require('argon2');
const { pool } = require('../config/database');
const { registerSchema, loginSchema } = require('../utils/validate');
const { sendSms } = require('../utils/sms');
const { sendEmail } = require('../utils/email');
const {
  normalizeEmail,
  normalizeLogin,
  normalizePhone,
  normalizePhoneDigits,
  normalizeAuthContact,
  isValidPhone,
} = require('../utils/authIdentity');

const DEV_RESET_CODE = '123456';
const DEV_REGISTRATION_CODE = '123456';

function buildUserLookupCondition(contact, startIndex = 1) {
  const clauses = [];
  const params = [];

  const normalizedEmail = normalizeEmail(contact);
  const normalizedLogin = normalizeLogin(contact);
  const normalizedPhone = normalizePhoneDigits(contact);

  if (normalizedEmail) {
    params.push(normalizedEmail);
    clauses.push(`email = $${startIndex + params.length - 1}`);
  }

  if (normalizedLogin) {
    params.push(normalizedLogin);
    clauses.push(`LOWER(login) = LOWER($${startIndex + params.length - 1})`);
  }

  // Сравнение телефона добавляем только если во входе реально есть номер.
  // Иначе пустое значение начинает матчить всех пользователей без телефона.
  if (normalizedPhone) {
    params.push(normalizedPhone);
    clauses.push(`regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $${startIndex + params.length - 1}`);
  }

  return {
    sql: clauses.length ? `(${clauses.join(' OR ')})` : '(FALSE)',
    params,
    nextIndex: startIndex + params.length,
  };
}

function getResetCode() {
  if (process.env.SMSRU_API_ID) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  return DEV_RESET_CODE;
}

function getRegistrationCode(contactType) {
  if (contactType === 'phone' && process.env.SMSRU_API_ID) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  if (contactType === 'email' && process.env.SMTP_USER) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  return DEV_REGISTRATION_CODE;
}

async function deliverResetCode(user, contactType, code) {
  const message = `Код восстановления: ${code}`;

  if (contactType === 'phone' && user.phone) {
    await sendSms(user.phone, message);
    return;
  }

  if (contactType === 'email' && user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Восстановление пароля — ЭнергоАтлант',
      html: `<p>Ваш код для восстановления пароля: <b>${code}</b></p><p>Код действует 15 минут.</p>`,
    });
    return;
  }

  if (user.phone) {
    await sendSms(user.phone, message);
    return;
  }

  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: 'Восстановление пароля — ЭнергоАтлант',
      html: `<p>Ваш код для восстановления пароля: <b>${code}</b></p><p>Код действует 15 минут.</p>`,
    });
  }
}

async function deliverRegistrationCode({ email, phone }, contactType, code) {
  const message = `Код подтверждения регистрации: ${code}`;

  if (contactType === 'phone' && phone) {
    await sendSms(phone, message);
    return true;
  }

  if (contactType === 'email' && email) {
    await sendEmail({
      to: email,
      subject: 'Подтверждение регистрации — ЭнергоАтлант',
      html: `<p>Ваш код подтверждения регистрации: <b>${code}</b></p><p>Код действует 15 минут.</p>`,
    });
    return true;
  }

  return false;
}

function getRegistrationChannel(data) {
  const email = normalizeEmail(data.email);
  const phone = normalizePhone(data.phone);

  if (phone) {
    return { type: 'phone', email: email || null, phone };
  }

  if (email) {
    return { type: 'email', email, phone: phone || null };
  }

  return { type: null, email: null, phone: null };
}

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, email, login, phone, password, role } = parsed.data;
    const channel = getRegistrationChannel(parsed.data);
    const normalizedEmail = channel.email;
    const normalizedLogin = normalizeLogin(login);
    const normalizedPhone = channel.phone;

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ success: false, error: 'Укажите корректный номер телефона' });
    }

    const uniquenessChecks = ['LOWER(login) = LOWER($1)'];
    const uniquenessParams = [normalizedLogin];

    if (normalizedEmail) {
      uniquenessParams.push(normalizedEmail);
      uniquenessChecks.push(`email = $${uniquenessParams.length}`);
    }

    if (normalizedPhone) {
      uniquenessParams.push(normalizePhoneDigits(normalizedPhone));
      uniquenessChecks.push(`regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $${uniquenessParams.length}`);
    }

    const existing = await pool.query(
      `SELECT id
       FROM users
       WHERE ${uniquenessChecks.join(' OR ')}`,
      uniquenessParams
    );
    if (existing.rows.length > 0) {
      let msg = 'Email, логин или телефон уже заняты';
      return res.status(400).json({ success: false, error: msg });
    }

    const password_hash = await argon2.hash(password, { type: argon2.argon2id });
    const verificationCode = getRegistrationCode(channel.type);
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO users (role, name, email, login, phone, password_hash, verification_code, verification_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, role, name, email, login, phone, is_verified, created_at`,
      [role, name.trim(), normalizedEmail || null, normalizedLogin, normalizedPhone || null, password_hash, verificationCode, verificationExpires]
    );

    await deliverRegistrationCode(
      { email: normalizedEmail, phone: normalizedPhone },
      channel.type,
      verificationCode
    );

    const verificationMessage = channel.type === 'phone'
      ? 'Код подтверждения отправлен по телефону'
      : 'Код подтверждения отправлен на email';

    const devMessage = verificationCode === DEV_REGISTRATION_CODE
      ? `${verificationMessage}. Тестовый код: 123456`
      : verificationMessage;

    return res.status(201).json({
      success: true,
      data: {
        ...result.rows[0],
        verification_contact: normalizedEmail || normalizedPhone,
        verification_type: channel.type,
      },
      message: devMessage,
    });
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

    const { login, password } = parsed.data;
    const lookup = buildUserLookupCondition(login);

    const result = await pool.query(
      `SELECT id, role, name, email, login, phone, password_hash, is_verified, is_deleted
       FROM users
       WHERE ${lookup.sql}`,
      lookup.params
    );

    const user = result.rows[0];

    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return res.status(401).json({ success: false, error: 'Неверные данные для входа или пароль' });
    }

    if (user.is_deleted) {
      return res.status(403).json({ success: false, error: 'Аккаунт удалён' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ success: false, error: 'Подтвердите регистрацию по коду из email или SMS' });
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
      `SELECT id, role, name, email, phone, is_verified, created_at
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

async function forgotPassword(req, res, next) {
  try {
    const { contact } = req.body;
    if (!contact) return res.status(400).json({ success: false, error: 'Укажите email, логин или телефон' });
    const normalizedContact = normalizeAuthContact(contact);
    const lookup = buildUserLookupCondition(normalizedContact.normalized);

    const result = await pool.query(
      `SELECT id, email, phone
       FROM users
       WHERE ${lookup.sql}
         AND is_deleted = FALSE`,
      lookup.params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Пользователь с такими данными не найден' });
    }

    const user = result.rows[0];
    const code = getResetCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      'UPDATE users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
      [code, expires, user.id]
    );

    await deliverResetCode(user, normalizedContact.type, code);

    const responseMessage = process.env.SMSRU_API_ID
      ? 'Код отправлен'
      : 'Код отправлен. Тестовый код: 123456';

    return res.json({ success: true, message: responseMessage });
  } catch (err) {
    return next(err);
  }
}

async function verifyCode(req, res, next) {
  try {
    const { contact, code } = req.body;
    if (!contact || !code) return res.status(400).json({ success: false, error: 'Укажите контакт и код' });
    const lookup = buildUserLookupCondition(contact, 1);

    const result = await pool.query(
      `SELECT id
       FROM users
       WHERE ${lookup.sql}
         AND reset_code = $${lookup.nextIndex}
         AND reset_expires > NOW()
         AND is_deleted = FALSE`,
      [...lookup.params, String(code).trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Неверный или просроченный код' });
    }

    return res.json({ success: true, message: 'Код подтвержден' });
  } catch (err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { contact, code, password } = req.body;
    if (!contact || !code || !password) return res.status(400).json({ success: false, error: 'Все поля обязательны' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Пароль слишком короткий' });
    const lookup = buildUserLookupCondition(contact, 1);

    const result = await pool.query(
      `SELECT id
       FROM users
       WHERE ${lookup.sql}
         AND reset_code = $${lookup.nextIndex}
         AND reset_expires > NOW()
         AND is_deleted = FALSE`,
      [...lookup.params, String(code).trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Сессия восстановления истекла' });
    }

    const userId = result.rows[0].id;
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    await pool.query(
      'UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [password_hash, userId]
    );

    return res.json({ success: true, message: 'Пароль успешно изменен' });
  } catch (err) {
    return next(err);
  }
}

async function verifyRegistration(req, res, next) {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ success: false, error: 'Укажите пользователя и код' });
    }

    const result = await pool.query(
      `UPDATE users
       SET is_verified = TRUE,
           verification_code = NULL,
           verification_expires = NULL
       WHERE id = $1
         AND verification_code = $2
         AND verification_expires > NOW()
         AND is_deleted = FALSE
       RETURNING id, role, name, email, phone, is_verified`,
      [userId, String(code).trim()]
    );

    if (!result.rows[0]) {
      return res.status(400).json({ success: false, error: 'Неверный или просроченный код подтверждения' });
    }

    return res.json({ success: true, data: result.rows[0], message: 'Регистрация подтверждена' });
  } catch (err) {
    return next(err);
  }
}

async function resendRegistrationCode(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Укажите пользователя' });
    }

    const result = await pool.query(
      `SELECT id, email, phone, is_verified, is_deleted
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];

    if (!user || user.is_deleted) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    if (user.is_verified) {
      return res.status(400).json({ success: false, error: 'Регистрация уже подтверждена' });
    }

    const contactType = user.phone ? 'phone' : 'email';
    const verificationCode = getRegistrationCode(contactType);
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET verification_code = $1,
           verification_expires = $2
       WHERE id = $3`,
      [verificationCode, verificationExpires, user.id]
    );

    await deliverRegistrationCode(
      { email: user.email, phone: user.phone },
      contactType,
      verificationCode
    );

    const verificationMessage = contactType === 'phone'
      ? 'Код подтверждения отправлен по телефону'
      : 'Код подтверждения отправлен на email';

    const devMessage = verificationCode === DEV_REGISTRATION_CODE
      ? `${verificationMessage}. Тестовый код: 123456`
      : verificationMessage;

    return res.json({ success: true, message: devMessage });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, logout, me, forgotPassword, verifyCode, resetPassword, verifyRegistration, resendRegistrationCode };
