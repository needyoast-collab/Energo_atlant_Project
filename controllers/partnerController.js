const { pool } = require('../config/database');
const { z } = require('zod');

const payoutSchema = z.object({
  amount:          z.number().positive(),
  payment_details: z.string().min(5).max(500),
});

// GET /api/partner/stats
async function getStats(req, res, next) {
  try {
    const userId = req.session.userId;

    const [refs, payouts] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'paid' THEN commission ELSE 0 END) as earned
         FROM partner_refs WHERE partner_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as paid_total,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_total
         FROM partner_payouts WHERE partner_id = $1`,
        [userId]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        refs_total:    parseInt(refs.rows[0].total),
        refs_paid:     parseInt(refs.rows[0].paid_count),
        earned:        parseFloat(refs.rows[0].earned) || 0,
        paid_total:    parseFloat(payouts.rows[0].paid_total) || 0,
        pending_total: parseFloat(payouts.rows[0].pending_total) || 0,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/partner/refs
async function getRefs(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.status, pr.commission, pr.created_at,
              u.name as referred_name, u.email as referred_email, u.role as referred_role
       FROM partner_refs pr
       JOIN users u ON u.id = pr.referred_user_id
       WHERE pr.partner_id = $1
       ORDER BY pr.created_at DESC`,
      [req.session.userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// POST /api/partner/payout-request
async function requestPayout(req, res, next) {
  try {
    const parsed = payoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { amount, payment_details } = parsed.data;

    // Проверка: нет активного запроса в ожидании
    const pending = await pool.query(
      `SELECT id FROM partner_payouts WHERE partner_id = $1 AND status = 'pending'`,
      [req.session.userId]
    );
    if (pending.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Уже есть необработанный запрос на выплату' });
    }

    const result = await pool.query(
      `INSERT INTO partner_payouts (partner_id, amount, payment_details)
       VALUES ($1, $2, $3)
       RETURNING id, amount, payment_details, status, created_at`,
      [req.session.userId, amount, payment_details]
    );

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
}

// GET /api/partner/payouts
async function getPayouts(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, amount, payment_details, status, created_at, processed_at
       FROM partner_payouts
       WHERE partner_id = $1
       ORDER BY created_at DESC`,
      [req.session.userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getStats, getRefs, requestPayout, getPayouts };
