const { z } = require('zod');
const { pool } = require('../config/database');

const pushTokenSchema = z.object({
  token: z.string().trim().min(20).max(500),
  platform: z.enum(['ios', 'android', 'web']),
  device_name: z.string().trim().max(100).optional(),
});

// POST /api/mobile/push-token
async function registerPushToken(req, res, next) {
  try {
    const parsed = pushTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { token, platform, device_name } = parsed.data;

    const result = await pool.query(
      `INSERT INTO mobile_push_tokens (user_id, token, platform, device_name, is_active, last_seen_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (token)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     platform = EXCLUDED.platform,
                     device_name = EXCLUDED.device_name,
                     is_active = TRUE,
                     last_seen_at = NOW()
       RETURNING id, user_id, token, platform, device_name, is_active, last_seen_at, created_at`,
      [req.session.userId, token, platform, device_name || null]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/mobile/push-token
async function unregisterPushToken(req, res, next) {
  try {
    const parsed = z.object({ token: z.string().trim().min(20).max(500) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    await pool.query(
      `UPDATE mobile_push_tokens
       SET is_active = FALSE,
           last_seen_at = NOW()
       WHERE token = $1
         AND user_id = $2`,
      [parsed.data.token, req.session.userId]
    );

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { registerPushToken, unregisterPushToken };
