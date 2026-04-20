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

// GET /api/admin/projects
async function getProjects(req, res, next) {
  try {
    const {
      q,
      status,
      progress,
      stage_state,
      created_from,
      created_to,
    } = req.query;

    const values = [];
    let idx = 1;
    const filters = ['p.is_deleted = FALSE'];

    if (q) {
      values.push(`%${q.trim()}%`);
      filters.push(`(p.code ILIKE $${idx} OR p.name ILIKE $${idx} OR COALESCE(p.address, '') ILIKE $${idx})`);
      idx++;
    }
    if (status) {
      values.push(status);
      filters.push(`p.status = $${idx++}`);
    }
    if (created_from) {
      values.push(created_from);
      filters.push(`p.created_at::date >= $${idx++}::date`);
    }
    if (created_to) {
      values.push(created_to);
      filters.push(`p.created_at::date <= $${idx++}::date`);
    }

    if (progress === 'green') {
      filters.push(`(p.status = 'won' OR (COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = COALESCE(st.stage_total, 0)))`);
    } else if (progress === 'yellow') {
      filters.push(`(COALESCE(st.stage_done, 0) > 0 AND NOT (p.status = 'won' OR (COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = COALESCE(st.stage_total, 0))))`);
    } else if (progress === 'red') {
      filters.push(`(COALESCE(st.stage_done, 0) = 0 AND p.status <> 'won')`);
    }

    if (stage_state === 'no_stages') {
      filters.push(`COALESCE(st.stage_total, 0) = 0`);
    } else if (stage_state === 'none_done') {
      filters.push(`COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = 0`);
    } else if (stage_state === 'has_done') {
      filters.push(`COALESCE(st.stage_done, 0) > 0`);
    } else if (stage_state === 'all_done') {
      filters.push(`COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = COALESCE(st.stage_total, 0)`);
    }

    const result = await pool.query(
      `SELECT p.id, p.code, p.name, p.status, p.address, p.contract_value, p.created_at,
              u.id as manager_id, u.name as manager_name,
              COALESCE(st.stage_total, 0)::int AS stage_total,
              COALESCE(st.stage_done, 0)::int AS stage_done,
              CASE
                WHEN p.status = 'won' OR (COALESCE(st.stage_total, 0) > 0 AND COALESCE(st.stage_done, 0) = COALESCE(st.stage_total, 0)) THEN 'green'
                WHEN COALESCE(st.stage_done, 0) > 0 THEN 'yellow'
                ELSE 'red'
              END AS progress_color
       FROM projects p
       LEFT JOIN users u ON u.id = p.manager_id
       LEFT JOIN (
         SELECT ps.project_id,
                COUNT(*) FILTER (WHERE ps.is_deleted = FALSE) AS stage_total,
                COUNT(*) FILTER (WHERE ps.is_deleted = FALSE AND ps.status = 'done') AS stage_done
         FROM project_stages ps
         GROUP BY ps.project_id
       ) st ON st.project_id = p.id
       WHERE ${filters.join(' AND ')}
       ORDER BY p.created_at DESC`,
      values
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    return next(err);
  }
}

// GET /api/admin/project-history
async function getProjectHistory(req, res, next) {
  try {
    const {
      project_id,
      changed_by,
      action,
      date_from,
      date_to,
      q,
      limit,
    } = req.query;

    const values = [];
    let idx = 1;
    const filters = ['1 = 1'];

    if (project_id) {
      values.push(project_id);
      filters.push(`ph.project_id = $${idx++}`);
    }
    if (changed_by) {
      values.push(changed_by);
      filters.push(`ph.changed_by = $${idx++}`);
    }
    if (action) {
      values.push(action);
      filters.push(`ph.action = $${idx++}`);
    }
    if (date_from) {
      values.push(date_from);
      filters.push(`ph.created_at::date >= $${idx++}::date`);
    }
    if (date_to) {
      values.push(date_to);
      filters.push(`ph.created_at::date <= $${idx++}::date`);
    }
    if (q) {
      values.push(`%${q.trim()}%`);
      filters.push(`(
        p.code ILIKE $${idx}
        OR p.name ILIKE $${idx}
        OR COALESCE(ph.field_name, '') ILIKE $${idx}
        OR COALESCE(ph.old_value, '') ILIKE $${idx}
        OR COALESCE(ph.new_value, '') ILIKE $${idx}
        OR COALESCE(ph.details, '') ILIKE $${idx}
      )`);
      idx++;
    }

    const parsedLimit = Number.parseInt(limit, 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(parsedLimit, 500))
      : 200;
    values.push(safeLimit);

    const result = await pool.query(
      `SELECT ph.id, ph.project_id, ph.changed_by, ph.action, ph.field_name,
              ph.old_value, ph.new_value, ph.details, ph.created_at,
              p.code AS project_code, p.name AS project_name,
              u.name AS changed_by_name, u.role AS changed_by_role
       FROM project_history ph
       JOIN projects p ON p.id = ph.project_id
       LEFT JOIN users u ON u.id = ph.changed_by
       WHERE ${filters.join(' AND ')}
       ORDER BY ph.created_at DESC
       LIMIT $${idx}`,
      values
    );

    return res.json({ success: true, data: result.rows });
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
  getProjects,
  getProjectHistory,
  getPartnerPayouts,
  updatePartnerPayout,
};
