// Проверка сессии — используется на всех дашбордах
async function requireAuth(expectedRole = null) {
  const { ok, data } = await apiRequest('GET', '/api/auth/me');
  if (!ok) {
    window.location.href = '/login.html';
    return null;
  }
  if (expectedRole && data.data.role !== expectedRole && data.data.role !== 'admin') {
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
