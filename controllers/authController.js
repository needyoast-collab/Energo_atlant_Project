const argon2 = require('argon2');
const { pool } = require('../config/database');
const {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  updateLoginSchema,
  requestEmailChangeSchema,
  confirmEmailChangeSchema,
  updateNotificationSettingsSchema,
  NOTIFICATION_TYPES,
} = require('../utils/validate');
const { sendSms } = require('../utils/sms');
const { sendEmail } = require('../utils/email');
const { getSignedDownloadUrl } = require('../utils/signedUrl');
const { deleteStoredObject } = require('../utils/storageObjects');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { randomUUID } = require('crypto');
const {
  normalizeEmail,
  normalizeLogin,
  normalizePhone,
  normalizePhoneDigits,
  normalizeAuthContact,
  isValidPhone,
} = require('../utils/authIdentity');
const { createMobileToken, MOBILE_TOKEN_TTL_SECONDS } = require('../utils/mobileToken');

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
  if (process.env.SMSRU_API_ID || process.env.SMTP_USER) {
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

function getRegistrationContact(user) {
  const type = user.phone ? 'phone' : 'email';
  return {
    verification_type: type,
    verification_contact: user.phone || user.email,
  };
}

function buildRegistrationUserData(user) {
  const contact = getRegistrationContact(user);
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    login: user.login,
    phone: user.phone,
    is_verified: user.is_verified,
    created_at: user.created_at,
    ...contact,
  };
}

async function buildUserProfileData(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    login: user.login,
    phone: user.phone,
    is_verified: user.is_verified,
    created_at: user.created_at,
    avatar_url: user.avatar_file_key ? await getSignedDownloadUrl(user.avatar_file_key) : null,
    notification_settings: user.notification_settings || {},
  };
}

async function issueRegistrationCode(user) {
  const contact = getRegistrationContact(user);
  const verificationCode = getRegistrationCode(contact.verification_type);
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
    contact.verification_type,
    verificationCode
  );

  const verificationMessage = contact.verification_type === 'phone'
    ? 'Код подтверждения отправлен по телефону'
    : 'Код подтверждения отправлен на email';

  return (verificationCode === DEV_REGISTRATION_CODE && process.env.NODE_ENV !== 'production')
    ? `${verificationMessage}. Тестовый код: 123456`
    : verificationMessage;
}

async function authenticateUserByPassword(login, password) {
  const lookup = buildUserLookupCondition(login);

  const result = await pool.query(
    `SELECT id, role, name, email, login, phone, password_hash, is_verified, is_deleted
     FROM users
     WHERE ${lookup.sql}`,
    lookup.params
  );

  const user = result.rows[0];

  if (!user || !(await argon2.verify(user.password_hash, password))) {
    return {
      status: 401,
      body: { success: false, error: 'Неверные данные для входа или пароль' },
    };
  }

  if (user.is_deleted) {
    return {
      status: 403,
      body: { success: false, error: 'Аккаунт удалён' },
    };
  }

  if (!user.is_verified) {
    return {
      status: 403,
      body: {
        success: false,
        error: 'Подтвердите регистрацию по коду из email или SMS',
        data: {
          requiresVerification: true,
          ...buildRegistrationUserData(user),
        },
      },
    };
  }

  return { user };
}

function buildLoginUserData(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    login: user.login,
    phone: user.phone,
  };
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
      `SELECT id, role, name, email, login, phone, is_verified, is_deleted, created_at
       FROM users
       WHERE ${uniquenessChecks.join(' OR ')}`,
      uniquenessParams
    );
    if (existing.rows.length > 0) {
      const activeVerified = existing.rows.find(user => user.is_verified && !user.is_deleted);
      if (activeVerified) {
        return res.status(400).json({ success: false, error: 'Email, логин или телефон уже заняты' });
      }

      const deletedUser = existing.rows.find(user => user.is_deleted);
      if (deletedUser) {
        return res.status(400).json({ success: false, error: 'Аккаунт с такими данными был удалён. Обратитесь к администратору' });
      }

      const pendingUser = existing.rows[0];
      const password_hash = await argon2.hash(password, { type: argon2.argon2id });
      const updated = await pool.query(
        `UPDATE users
         SET name = $1,
             role = $2,
             password_hash = $3
         WHERE id = $4
         RETURNING id, role, name, email, login, phone, is_verified, created_at`,
        [name.trim(), role, password_hash, pendingUser.id]
      );
      const message = await issueRegistrationCode(updated.rows[0]);

      return res.json({
        success: true,
        data: buildRegistrationUserData(updated.rows[0]),
        message: `Регистрация уже начата. ${message}`,
      });
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

    const devMessage = (verificationCode === DEV_REGISTRATION_CODE && process.env.NODE_ENV !== 'production')
      ? `${verificationMessage}. Тестовый код: 123456`
      : verificationMessage;

    return res.status(201).json({
      success: true,
      data: {
        ...buildRegistrationUserData(result.rows[0]),
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

    const authResult = await authenticateUserByPassword(parsed.data.login, parsed.data.password);
    if (!authResult.user) {
      return res.status(authResult.status).json(authResult.body);
    }
    const { user } = authResult;

    req.session.userId = user.id;
    req.session.userRole = user.role;

    if (typeof req.resetLoginRateLimit === 'function') {
      try {
        await req.resetLoginRateLimit();
      } catch (err) {
        console.warn('[AUTH] Не удалось сбросить лимит входа:', err.message);
      }
    }

    return res.json({
      success: true,
      data: buildLoginUserData(user),
    });
  } catch (err) {
    return next(err);
  }
}

async function mobileLogin(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const authResult = await authenticateUserByPassword(parsed.data.login, parsed.data.password);
    if (!authResult.user) {
      return res.status(authResult.status).json(authResult.body);
    }
    const { user } = authResult;
    const token = createMobileToken(user);

    if (typeof req.resetLoginRateLimit === 'function') {
      try {
        await req.resetLoginRateLimit();
      } catch (err) {
        console.warn('[AUTH] Не удалось сбросить лимит входа:', err.message);
      }
    }

    return res.json({
      success: true,
      data: {
        token,
        token_type: 'Bearer',
        expires_in: MOBILE_TOKEN_TTL_SECONDS,
        user: buildLoginUserData(user),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function mobileLogout(req, res, next) {
  try {
    return res.json({ success: true });
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
      `SELECT id, role, name, email, login, phone, is_verified, avatar_file_key, created_at, notification_settings
       FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [req.session.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: await buildUserProfileData(result.rows[0]) });
  } catch (err) {
    return next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, phone } = parsed.data;
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    if (phone && !normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Укажите корректный номер телефона' });
    }

    if (normalizedPhone) {
      const existing = await pool.query(
        `SELECT id
         FROM users
         WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
           AND id <> $2
           AND is_deleted = FALSE`,
        [normalizePhoneDigits(normalizedPhone), req.session.userId]
      );
      if (existing.rows[0]) {
        return res.status(400).json({ success: false, error: 'Этот телефон уже используется' });
      }
    }

    const result = await pool.query(
      `UPDATE users
       SET name = $1,
           phone = $2
       WHERE id = $3 AND is_deleted = FALSE
       RETURNING id, role, name, email, login, phone, is_verified, avatar_file_key, created_at, notification_settings`,
      [name.trim(), normalizedPhone, req.session.userId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: await buildUserProfileData(result.rows[0]), message: 'Профиль обновлён' });
  } catch (err) {
    return next(err);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Файл не загружен' });
    }

    if (!s3) {
      return res.status(503).json({ success: false, error: 'Хранилище файлов недоступно' });
    }

    const current = await pool.query(
      `SELECT avatar_file_key
       FROM users
       WHERE id = $1 AND is_deleted = FALSE`,
      [req.session.userId]
    );
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const extByMime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extByMime[req.file.mimetype] || 'jpg';
    const fileKey = `avatars/${req.session.userId}/${randomUUID()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    await pool.query(
      `UPDATE users
       SET avatar_file_key = $1
       WHERE id = $2`,
      [fileKey, req.session.userId]
    );

    if (current.rows[0].avatar_file_key) {
      try {
        await deleteStoredObject(current.rows[0].avatar_file_key);
      } catch (err) {
        console.warn('[AUTH] Не удалось удалить старый аватар:', err.message);
      }
    }

    return res.json({
      success: true,
      data: {
        avatar_url: await getSignedDownloadUrl(fileKey),
      },
      message: 'Аватар обновлён',
    });
  } catch (err) {
    return next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { current_password, new_password } = parsed.data;
    const result = await pool.query(
      `SELECT id, password_hash
       FROM users
       WHERE id = $1 AND is_deleted = FALSE`,
      [req.session.userId]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const validPassword = await argon2.verify(user.password_hash, current_password);
    if (!validPassword) {
      return res.status(400).json({ success: false, error: 'Текущий пароль указан неверно' });
    }

    const passwordHash = await argon2.hash(new_password, { type: argon2.argon2id });
    await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2`,
      [passwordHash, req.session.userId]
    );

    return res.json({ success: true, message: 'Пароль изменён' });
  } catch (err) {
    return next(err);
  }
}

async function updateLogin(req, res, next) {
  try {
    const parsed = updateLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { login } = parsed.data;
    const existing = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(login) = LOWER($1) AND id <> $2 AND is_deleted = FALSE`,
      [login, req.session.userId]
    );
    if (existing.rows[0]) {
      return res.status(400).json({ success: false, error: 'Этот логин уже занят' });
    }

    const result = await pool.query(
      `UPDATE users SET login = $1
       WHERE id = $2 AND is_deleted = FALSE
       RETURNING id, role, name, email, login, phone, is_verified, avatar_file_key, created_at, notification_settings`,
      [login, req.session.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    return res.json({ success: true, data: await buildUserProfileData(result.rows[0]), message: 'Логин обновлён' });
  } catch (err) {
    return next(err);
  }
}

async function requestEmailChange(req, res, next) {
  try {
    const parsed = requestEmailChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const newEmail = normalizeEmail(parsed.data.new_email);
    if (!newEmail) {
      return res.status(400).json({ success: false, error: 'Укажите корректный email' });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND id <> $2 AND is_deleted = FALSE`,
      [newEmail, req.session.userId]
    );
    if (existing.rows[0]) {
      return res.status(400).json({ success: false, error: 'Этот email уже используется' });
    }

    const code = getResetCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET email_change_pending = $1, email_change_code = $2, email_change_expires = $3
       WHERE id = $4`,
      [newEmail, code, expires, req.session.userId]
    );

    await sendEmail({
      to: newEmail,
      subject: 'Подтверждение смены email — ЭнергоАтлант',
      html: `<p>Код подтверждения для смены email: <b>${code}</b></p><p>Код действует 15 минут.</p>`,
    });

    const message = (process.env.SMTP_USER)
      ? 'Код отправлен на новый email'
      : `Код отправлен. Тестовый код: ${code}`;

    return res.json({ success: true, message });
  } catch (err) {
    return next(err);
  }
}

async function confirmEmailChange(req, res, next) {
  try {
    const parsed = confirmEmailChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const result = await pool.query(
      `UPDATE users
       SET email = email_change_pending,
           email_change_pending = NULL,
           email_change_code = NULL,
           email_change_expires = NULL
       WHERE id = $1
         AND email_change_code = $2
         AND email_change_expires > NOW()
         AND is_deleted = FALSE
       RETURNING id, role, name, email, login, phone, is_verified, avatar_file_key, created_at, notification_settings`,
      [req.session.userId, String(parsed.data.code).trim()]
    );

    if (!result.rows[0]) {
      return res.status(400).json({ success: false, error: 'Неверный или просроченный код' });
    }

    return res.json({ success: true, data: await buildUserProfileData(result.rows[0]), message: 'Email обновлён' });
  } catch (err) {
    return next(err);
  }
}

async function updateNotificationSettings(req, res, next) {
  try {
    const parsed = updateNotificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    // Берём текущие настройки и мержим — клиент отправляет только изменённые поля
    const current = await pool.query(
      `SELECT notification_settings FROM users WHERE id = $1 AND is_deleted = FALSE`,
      [req.session.userId]
    );
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const merged = { ...(current.rows[0].notification_settings || {}), ...parsed.data };

    // Убираем true-значения: хранить нужно только false, остальное считается включённым
    for (const key of NOTIFICATION_TYPES) {
      if (merged[key] === true) delete merged[key];
    }

    await pool.query(
      `UPDATE users SET notification_settings = $1 WHERE id = $2`,
      [JSON.stringify(merged), req.session.userId]
    );

    return res.json({ success: true, data: { notification_settings: merged }, message: 'Настройки уведомлений сохранены' });
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

    const responseMessage = (process.env.SMSRU_API_ID || process.env.SMTP_USER)
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
      `SELECT id, email, phone, is_verified
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
      `SELECT id, email, phone, is_verified
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

    const user = result.rows[0];
    const password_hash = await argon2.hash(password, { type: argon2.argon2id });

    await pool.query(
      'UPDATE users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [password_hash, user.id]
    );

    return res.json({
      success: true,
      data: user.is_verified
        ? { requiresVerification: false }
        : {
            requiresVerification: true,
            id: user.id,
            ...getRegistrationContact(user),
          },
      message: 'Пароль успешно изменен',
    });
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
    const { userId, contact } = req.body;
    if (!userId && !contact) {
      return res.status(400).json({ success: false, error: 'Укажите пользователя или контакт' });
    }

    const lookup = userId
      ? { sql: 'id = $1', params: [userId] }
      : buildUserLookupCondition(contact);

    const result = await pool.query(
      `SELECT id, role, name, email, login, phone, is_verified, is_deleted, created_at
       FROM users
       WHERE ${lookup.sql}`,
      lookup.params
    );

    const user = result.rows[0];

    if (!user || user.is_deleted) {
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    if (user.is_verified) {
      return res.status(400).json({ success: false, error: 'Регистрация уже подтверждена' });
    }

    const devMessage = await issueRegistrationCode(user);

    return res.json({
      success: true,
      data: buildRegistrationUserData(user),
      message: devMessage,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  mobileLogin,
  mobileLogout,
  logout,
  me,
  updateProfile,
  changePassword,
  uploadAvatar,
  updateLogin,
  requestEmailChange,
  confirmEmailChange,
  updateNotificationSettings,
  forgotPassword,
  verifyCode,
  resetPassword,
  verifyRegistration,
  resendRegistrationCode,
};
