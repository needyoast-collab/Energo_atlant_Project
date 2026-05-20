window.APP_ROLES = window.APP_ROLES || Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  FOREMAN: 'foreman',
  SUPPLIER: 'supplier',
  PTO: 'pto',
  CUSTOMER: 'customer',
  PARTNER: 'partner',
});

// Проверка сессии — используется на всех дашбордах
async function requireAuth(expectedRole = null) {
  const { ok, data } = await apiRequest('GET', '/api/auth/me');
  if (!ok) {
    window.location.href = '/login.html';
    return null;
  }
  if (expectedRole && data.data.role !== expectedRole && data.data.role !== window.APP_ROLES.ADMIN) {
    window.location.href = '/login.html';
    return null;
  }
  return data.data;
}

// Выход
async function logout() {
  try { await apiRequest('POST', '/api/auth/logout'); } catch (_) {}
  window.location.href = '/login.html';
}
