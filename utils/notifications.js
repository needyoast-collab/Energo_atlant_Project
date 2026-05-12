const { pool } = require('../config/database');
const { ROLES } = require('../middleware/auth');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function deactivatePushTokens(tokens) {
  if (tokens.length === 0) return;

  await pool.query(
    `UPDATE mobile_push_tokens
     SET is_active = FALSE,
         last_seen_at = NOW()
     WHERE token = ANY($1::text[])`,
    [tokens]
  );
}

async function sendMobilePush({ userId, projectId = null, type, message, entityType = null, entityId = null }) {
  const result = await pool.query(
    `SELECT token
     FROM mobile_push_tokens
     WHERE user_id = $1
       AND is_active = TRUE`,
    [userId]
  );

  if (result.rows.length === 0) return;

  const messages = result.rows.map(({ token }) => ({
    to: token,
    sound: 'default',
    title: 'ЭнергоАтлант',
    body: message,
    data: {
      project_id: projectId,
      type,
      entity_type: entityType,
      entity_id: entityId,
    },
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push failed with status ${response.status}`);
  }

  const payload = await response.json();
  const receipts = Array.isArray(payload.data) ? payload.data : [];
  const inactiveTokens = [];

  receipts.forEach((receipt, index) => {
    if (receipt?.details?.error === 'DeviceNotRegistered') {
      inactiveTokens.push(messages[index].to);
    }
  });

  await deactivatePushTokens(inactiveTokens);
}

async function sendNotification({ userId, projectId = null, type, message, entityType = null, entityId = null }) {
  await pool.query(
    `INSERT INTO notifications (user_id, project_id, type, entity_type, entity_id, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, projectId, type, entityType, entityId, message]
  );

  sendMobilePush({ userId, projectId, type, message, entityType, entityId }).catch((err) => {
    console.warn('[PUSH] Не удалось отправить push:', err.message);
  });
}

async function notifyManagersAboutRequest({ requestId, name, phone, email }) {
  const managers = await pool.query(
    `SELECT id
     FROM users
     WHERE role = $1
       AND is_deleted = FALSE
       AND is_verified = TRUE`,
    [ROLES.MANAGER]
  );

  if (managers.rows.length === 0) return;

  const contact = phone || email || 'контакт не указан';
  const author = name || 'Новая заявка';
  await Promise.all(managers.rows.map((manager) => sendNotification({
    userId: manager.id,
    type: 'status',
    message: `Новая заявка #${requestId}: ${author}, ${contact}`,
  })));
}

module.exports = { sendNotification, notifyManagersAboutRequest, sendMobilePush };
