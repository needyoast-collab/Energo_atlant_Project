const { pool } = require('../config/database');
const { verifyMobileToken } = require('../utils/mobileToken');
const { ROLES } = require('../utils/constants');

function getBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function attachMobileAuth(req) {
  const token = getBearerToken(req);

  if (!token && req.session && req.session.userId) {
    return true;
  }

  if (!token) {
    return false;
  }

  const payload = verifyMobileToken(token);
  if (!payload) {
    return false;
  }

  const result = await pool.query(
    `SELECT id, role
     FROM users
     WHERE id = $1
       AND is_verified = TRUE
       AND is_deleted = FALSE`,
    [payload.sub]
  );
  const user = result.rows[0];

  if (!user) {
    return false;
  }

  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.mobileAuth = true;

  return true;
}

async function isAuthenticated(req, res, next) {
  try {
    if (await attachMobileAuth(req)) {
      return next();
    }

    return res.status(401).json({ success: false, error: 'Не авторизован' });
  } catch (err) {
    return next(err);
  }
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return async (req, res, next) => {
    try {
      if (!(await attachMobileAuth(req))) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
      }

      if (!allowed.includes(req.session.userRole)) {
        return res.status(403).json({ success: false, error: 'Доступ запрещён' });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { ROLES, isAuthenticated, requireRole };
