const ROLE_DASHBOARD = {
  admin: '/dashboard_admin.html',
  manager: '/dashboard_manager.html',
  foreman: '/dashboard_foreman.html',
  supplier: '/dashboard_supplier.html',
  pto: '/dashboard_pto.html',
  customer: '/dashboard_customer.html',
  partner: '/dashboard_partner.html',
};

const ROLE_LABEL = {
  admin: 'Администратор',
  manager: 'Менеджер',
  foreman: 'Прораб',
  supplier: 'Снабженец',
  pto: 'ПТО',
  customer: 'Заказчик',
  partner: 'Партнёр',
};

let profileUser = null;

async function initProfile() {
  try {
    profileUser = await requireAuth();
    if (!profileUser) return;

    document.getElementById('profile-back-link').href = ROLE_DASHBOARD[profileUser.role] || '/login.html';
    renderProfile(profileUser);
  } finally {
    window.hidePreloader?.();
  }
}

function renderProfile(user) {
  renderAvatar(document.getElementById('profile-avatar'), user);
  document.getElementById('profile-role').textContent = ROLE_LABEL[user.role] || user.role || '—';
  document.getElementById('profile-login').textContent = user.login || '—';
  document.getElementById('profile-email').textContent = user.email || '—';
  document.getElementById('profile-created').textContent = user.created_at ? formatDate(user.created_at) : '—';
  document.getElementById('profile-name').value = user.name || '';
  document.getElementById('profile-phone').value = user.phone || '';
}

function renderAvatar(container, user) {
  if (!container) return;
  if (user.avatar_url) {
    container.innerHTML = `<img src="${user.avatar_url}" alt="">`;
    return;
  }

  const initials = String(user.name || user.login || user.email || '—')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  container.textContent = initials || '—';
}

document.getElementById('profile-avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('avatar', file);

  const { ok, data } = await apiRequest('POST', '/api/auth/avatar', fd);
  e.target.value = '';

  if (!ok) {
    showToast(data.error || 'Не удалось загрузить аватар', 'error');
    return;
  }

  profileUser.avatar_url = data.data.avatar_url;
  renderProfile(profileUser);
  showToast(data.message || 'Аватар обновлён', 'success');
});

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById('profile-name').value,
    phone: document.getElementById('profile-phone').value,
  };

  const { ok, data } = await apiRequest('PUT', '/api/auth/profile', body);
  if (!ok) {
    showToast(data.error || 'Не удалось сохранить профиль', 'error');
    return;
  }

  profileUser = data.data;
  renderProfile(profileUser);
  showToast(data.message || 'Профиль сохранён', 'success');
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const currentPassword = formData.get('current_password');
  const newPassword = formData.get('new_password');
  const repeatPassword = formData.get('new_password_repeat');

  if (newPassword !== repeatPassword) {
    showToast('Новые пароли не совпадают', 'error');
    return;
  }

  const { ok, data } = await apiRequest('PUT', '/api/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });

  if (!ok) {
    showToast(data.error || 'Не удалось изменить пароль', 'error');
    return;
  }

  e.target.reset();
  showToast(data.message || 'Пароль изменён', 'success');
});

initProfile();
