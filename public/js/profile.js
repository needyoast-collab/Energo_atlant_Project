const ROLE_DASHBOARD = {
  admin:    '/dashboard_admin.html',
  manager:  '/dashboard_manager.html',
  foreman:  '/dashboard_foreman.html',
  supplier: '/dashboard_supplier.html',
  pto:      '/dashboard_pto.html',
  customer: '/dashboard_customer.html',
  partner:  '/dashboard_partner.html',
};

const ROLE_LABEL = {
  admin:    'Администратор',
  manager:  'Менеджер',
  foreman:  'Прораб',
  supplier: 'Снабженец',
  pto:      'ПТО',
  customer: 'Заказчик',
  partner:  'Партнёр',
};

// Настройки уведомлений по типу — метка и для каких ролей актуально
const NOTIF_TYPES = [
  { key: 'photo',    label: 'Фото этапов',              roles: ['admin', 'manager', 'customer'] },
  { key: 'document', label: 'Новые документы',           roles: ['admin', 'manager', 'foreman', 'pto', 'customer'] },
  { key: 'status',   label: 'Смена статуса этапа',       roles: ['admin', 'manager', 'customer'] },
  { key: 'message',  label: 'Новые сообщения',           roles: ['admin', 'manager', 'customer'] },
  { key: 'mtr',      label: 'Заявки на материалы (МТР)', roles: ['admin', 'manager', 'foreman', 'supplier'] },
];

let profileUser = null;

// ── Вкладки ────────────────────────────────────────────────────────────────

document.querySelectorAll('.profile-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.profile-tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Инициализация ──────────────────────────────────────────────────────────

async function initProfile() {
  try {
    profileUser = await requireAuth();
    if (!profileUser) return;

    document.getElementById('profile-back-link').href = ROLE_DASHBOARD[profileUser.role] || '/login.html';
    renderProfile(profileUser);
    renderNotifSettings(profileUser);
  } finally {
    window.hidePreloader?.();
  }
}

function renderProfile(user) {
  renderAvatar(document.getElementById('profile-avatar'), user);

  document.getElementById('profile-display-name').textContent = user.name || user.login || '—';
  document.getElementById('profile-role-badge').textContent = ROLE_LABEL[user.role] || user.role || '';

  // Вкладка Профиль
  document.getElementById('profile-name').value = user.name || '';
  document.getElementById('profile-login-input').value = user.login || '';
  document.getElementById('profile-phone').value = user.phone || '';

  // Вкладка Безопасность
  document.getElementById('profile-email-display').textContent = user.email || '—';

  // Вкладка Аккаунт
  document.getElementById('profile-role').textContent = ROLE_LABEL[user.role] || user.role || '—';
  document.getElementById('profile-email-account').textContent = user.email || '—';
  document.getElementById('profile-login-display').textContent = user.login || '—';
  document.getElementById('profile-verified').textContent = user.is_verified ? '✓ Подтверждён' : '⚠ Не подтверждён';
  document.getElementById('profile-id').textContent = `#${user.id}`;
  document.getElementById('profile-created').textContent = user.created_at ? formatDate(user.created_at) : '—';
}

function renderAvatar(container, user) {
  if (!container) return;
  const avatarUrl = safeUrl(user.avatar_url, '');
  if (avatarUrl) {
    container.textContent = '';
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = '';
    container.appendChild(img);
    return;
  }
  const initials = String(user.name || user.login || user.email || '—')
    .trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  container.textContent = initials || '—';
}

function renderNotifSettings(user) {
  const list = document.getElementById('notif-settings-list');
  const settings = user.notification_settings || {};
  const relevantTypes = NOTIF_TYPES.filter((t) => t.roles.includes(user.role));

  if (relevantTypes.length === 0) {
    list.innerHTML = '<p class="profile-note">Для вашей роли уведомления не настраиваются.</p>';
    return;
  }

  list.innerHTML = relevantTypes.map((t) => {
    const enabled = settings[t.key] !== false;
    return `
      <label class="notif-toggle-row">
        <span class="notif-toggle-label">${t.label}</span>
        <input type="checkbox" class="notif-toggle" data-key="${t.key}" ${enabled ? 'checked' : ''}>
        <span class="notif-toggle-switch"></span>
      </label>
    `;
  }).join('');
}

// ── Аватар ─────────────────────────────────────────────────────────────────

document.getElementById('profile-avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('avatar', file);

  const { ok, data } = await apiRequest('POST', '/api/auth/avatar', fd);
  e.target.value = '';

  if (!ok) { showToast(data.error || 'Не удалось загрузить фото', 'error'); return; }

  profileUser.avatar_url = data.data.avatar_url;
  renderProfile(profileUser);
  showToast('Фото обновлено', 'success');
});

// ── Форма профиля (имя, логин, телефон) ───────────────────────────────────

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name  = document.getElementById('profile-name').value.trim();
  const login = document.getElementById('profile-login-input').value.trim();
  const phone = document.getElementById('profile-phone').value.trim();

  // Сначала сохраняем имя+телефон
  const profileResult = await apiRequest('PUT', '/api/auth/profile', { name, phone });
  if (!profileResult.ok) {
    showToast(profileResult.data.error || 'Ошибка сохранения', 'error');
    return;
  }

  // Если логин изменился — отдельный запрос
  if (login && login !== profileUser.login) {
    const loginResult = await apiRequest('PUT', '/api/auth/login', { login });
    if (!loginResult.ok) {
      showToast(loginResult.data.error || 'Ошибка смены логина', 'error');
      return;
    }
    profileUser = loginResult.data.data;
  } else {
    profileUser = profileResult.data.data;
  }

  renderProfile(profileUser);
  showToast('Профиль сохранён', 'success');
});

// ── Смена email ────────────────────────────────────────────────────────────

document.getElementById('request-email-change-btn').addEventListener('click', async () => {
  const newEmail = document.getElementById('new-email-input').value.trim();
  if (!newEmail) { showToast('Введите новый email', 'error'); return; }

  const { ok, data } = await apiRequest('POST', '/api/auth/email-change/request', { new_email: newEmail });
  if (!ok) { showToast(data.error || 'Ошибка', 'error'); return; }

  document.getElementById('email-change-step1').classList.add('hidden');
  document.getElementById('email-change-step2').classList.remove('hidden');
  showToast(data.message || 'Код отправлен', 'success');
});

document.getElementById('confirm-email-change-btn').addEventListener('click', async () => {
  const code = document.getElementById('email-change-code').value.trim();
  if (!code) { showToast('Введите код', 'error'); return; }

  const { ok, data } = await apiRequest('POST', '/api/auth/email-change/confirm', { code });
  if (!ok) { showToast(data.error || 'Неверный код', 'error'); return; }

  profileUser = data.data;
  renderProfile(profileUser);
  resetEmailChangeUI();
  showToast('Email обновлён', 'success');
});

document.getElementById('cancel-email-change-btn').addEventListener('click', resetEmailChangeUI);

function resetEmailChangeUI() {
  document.getElementById('new-email-input').value = '';
  document.getElementById('email-change-code').value = '';
  document.getElementById('email-change-step1').classList.remove('hidden');
  document.getElementById('email-change-step2').classList.add('hidden');
}

// ── Смена пароля ───────────────────────────────────────────────────────────

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const currentPassword = formData.get('current_password');
  const newPassword     = formData.get('new_password');
  const repeatPassword  = formData.get('new_password_repeat');

  if (newPassword !== repeatPassword) { showToast('Новые пароли не совпадают', 'error'); return; }

  const { ok, data } = await apiRequest('PUT', '/api/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });

  if (!ok) { showToast(data.error || 'Ошибка смены пароля', 'error'); return; }

  e.target.reset();
  showToast(data.message || 'Пароль изменён', 'success');
});

// ── Уведомления ────────────────────────────────────────────────────────────

document.getElementById('save-notif-btn').addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('.notif-toggle');
  const settings = {};
  checkboxes.forEach((cb) => {
    if (!cb.checked) settings[cb.dataset.key] = false;
  });

  const { ok, data } = await apiRequest('PUT', '/api/auth/notification-settings', settings);
  if (!ok) { showToast(data.error || 'Ошибка сохранения', 'error'); return; }

  profileUser.notification_settings = data.data.notification_settings;
  showToast('Настройки уведомлений сохранены', 'success');
});

initProfile();
