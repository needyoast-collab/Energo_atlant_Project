const ROLES = {
  ADMIN:    'admin',
  MANAGER:  'manager',
  FOREMAN:  'foreman',
  SUPPLIER: 'supplier',
  PTO:      'pto',
  CUSTOMER: 'customer',
  PARTNER:  'partner',
};

function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Не авторизован' });
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    if (!allowed.includes(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }
    return next();
  };
}

module.exports = { ROLES, isAuthenticated, requireRole };
