let currentUser = null;
const PROJECT_STATUS_LABELS = {
  lead: 'Лид',
  qualification: 'Квалификация',
  visit: 'Выезд',
  offer: 'КП',
  negotiation: 'Переговоры',
  contract: 'Договор',
  work: 'В работе',
  won: 'Завершён',
  lost: 'Отказ',
};
const PROGRESS_COLORS = { green: '#22c55e', yellow: '#f59e0b', red: '#ef4444' };
const PROGRESS_LABELS = { green: 'Завершён', yellow: 'В работе', red: 'Не начат' };

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('admin');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  loadMetrics();
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'users')   loadUsers();
  if (section === 'projects') loadProjects();
  if (section === 'project-history') loadProjectHistory();
  if (section === 'payouts') loadPayouts();
});

// ─── Метрики ─────────────────────────────────────────────────
async function loadMetrics() {
  const { ok, data } = await apiRequest('GET', '/api/admin/metrics');
  if (!ok) return;

  const m = data.data;
  const totalUsers    = m.users.reduce((s, r) => s + parseInt(r.count), 0);
  const totalProjects = m.projects.reduce((s, r) => s + parseInt(r.count), 0);
  const totalRequests = m.requests.reduce((s, r) => s + parseInt(r.count), 0);
  const totalPayouts  = m.payouts.reduce((s, r) => s + parseInt(r.count), 0);

  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = `
    <div class="metric-card"><div class="metric-value">${totalUsers}</div><div class="metric-label">Пользователей</div></div>
    <div class="metric-card"><div class="metric-value">${totalProjects}</div><div class="metric-label">Проектов</div></div>
    <div class="metric-card"><div class="metric-value">${totalRequests}</div><div class="metric-label">Заявок с сайта</div></div>
    <div class="metric-card"><div class="metric-value">${totalPayouts}</div><div class="metric-label">Запросов выплат</div></div>
  `;

  const tbody = document.querySelector('#projects-stat-table tbody');
  tbody.innerHTML = m.projects.map(p => `
    <tr><td>${badge(p.status)}</td><td>${p.count}</td></tr>
  `).join('');
}

function makeQueryFromForm(form) {
  const fd = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, raw] of fd.entries()) {
    const value = String(raw).trim();
    if (value) params.set(key, value);
  }
  return params.toString() ? `?${params.toString()}` : '';
}

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const form = document.getElementById('projects-filter-form');
  const query = form ? makeQueryFromForm(form) : '';
  const tbody = document.querySelector('#admin-projects-table tbody');
  let resp = await apiRequest('GET', `/api/admin/projects${query}`);

  // Fallback: если backend ещё не перезапущен и нет admin endpoint,
  // берём список из manager endpoint (admin туда допущен по ролям).
  if (!resp.ok && resp.status === 404) {
    resp = await apiRequest('GET', '/api/manager/projects');
  }

  if (!resp.ok) {
    const msg = resp.data?.error || `Ошибка загрузки (${resp.status})`;
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted">${escHtml(msg)}</td></tr>`;
    showToast(msg, 'error');
    return;
  }

  const list = resp.data?.data || [];
  tbody.innerHTML = list.map(p => `
    <tr>
      <td>
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${PROGRESS_COLORS[p.progress_color] || '#6b7280'};vertical-align:middle;margin-right:6px"></span>
        <span style="font-size:.8rem;color:var(--muted)">${PROGRESS_LABELS[p.progress_color] || '—'}</span>
      </td>
      <td>${escHtml(p.code)}</td>
      <td>${escHtml(p.name)}</td>
      <td>${badge(PROJECT_STATUS_LABELS[p.status] || p.status)}</td>
      <td>${p.stage_done}/${p.stage_total}</td>
      <td>${escHtml(p.address || '—')}</td>
      <td>${escHtml(p.manager_name || '—')}</td>
      <td>${formatDate(p.created_at)}</td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="text-muted">Проектов нет</td></tr>';
}

// ─── История проектов ────────────────────────────────────────
async function loadProjectHistory() {
  const form = document.getElementById('project-history-filter-form');
  const query = form ? makeQueryFromForm(form) : '';
  const { ok, data, status } = await apiRequest('GET', `/api/admin/project-history${query}`);

  const tbody = document.querySelector('#project-history-table tbody');
  if (!ok) {
    const msg = data?.error || `Ошибка загрузки (${status})`;
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted">${escHtml(msg)}</td></tr>`;
    showToast(msg, 'error');
    return;
  }

  tbody.innerHTML = data.data.map(h => `
    <tr>
      <td>${formatDateTime(h.created_at)}</td>
      <td>${escHtml(h.project_code)}<br><span class="text-muted" style="font-size:.78rem">${escHtml(h.project_name || '')}</span></td>
      <td><span class="badge badge-gray">${escHtml(h.action)}</span></td>
      <td>${escHtml(h.field_name || '—')}</td>
      <td style="max-width:180px;word-break:break-word;font-size:.82rem">${escHtml(h.old_value || '—')}</td>
      <td style="max-width:180px;word-break:break-word;font-size:.82rem">${escHtml(h.new_value || '—')}</td>
      <td>${escHtml(h.changed_by_name || 'Система')}<br><span class="text-muted" style="font-size:.78rem">${escHtml(h.changed_by_role || '')}</span></td>
      <td style="max-width:220px;word-break:break-word;font-size:.82rem">${escHtml(h.details || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="8" class="text-muted">История пуста</td></tr>';
}

// ─── Пользователи ─────────────────────────────────────────────
async function loadUsers() {
  const { ok, data } = await apiRequest('GET', '/api/admin/users');
  if (!ok) return;

  const ROLE_LABELS = { admin:'Администратор', manager:'Менеджер', foreman:'Прораб',
    supplier:'Снабженец', pto:'ПТО', customer:'Заказчик', partner:'Партнёр' };

  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = data.data.map(u => `
    <tr>
      <td>${escHtml(u.name)}</td>
      <td>${escHtml(u.email)}</td>
      <td>${ROLE_LABELS[u.role] || u.role}</td>
      <td>
        ${u.is_deleted ? '<span class="badge badge-red">Удалён</span>' :
          u.is_verified ? '<span class="badge badge-green">Активен</span>' :
          '<span class="badge badge-yellow">Ожидает верификации</span>'}
      </td>
      <td>
        <div class="flex gap-1">
          ${!u.is_deleted && !u.is_verified ? `<button class="btn btn-sm btn-primary" data-action="verify" data-id="${u.id}">Верифицировать</button>` : ''}
          ${!u.is_deleted ? `<button class="btn btn-sm btn-outline" data-action="edit" data-id="${u.id}" data-name="${escHtml(u.name)}" data-email="${escHtml(u.email)}" data-role="${u.role}">Изменить</button>` : ''}
          ${!u.is_deleted ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${u.id}">Удалить</button>` : ''}
          ${u.is_deleted ? `<button class="btn btn-sm btn-outline" data-action="restore" data-id="${u.id}">Восстановить</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// ─── Делегирование: таблица пользователей ────────────────────
document.getElementById('users-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name, email, role } = btn.dataset;

  if (action === 'verify') {
    const { ok, data } = await apiRequest('POST', `/api/admin/users/${id}/verify`);
    if (ok) { showToast('Пользователь верифицирован', 'success'); loadUsers(); }
    else showToast(data.error, 'error');
  }
  if (action === 'delete') {
    if (!confirm('Удалить пользователя?')) return;
    const { ok, data } = await apiRequest('DELETE', `/api/admin/users/${id}`);
    if (ok) { showToast('Удалён', 'success'); loadUsers(); }
    else showToast(data.error, 'error');
  }
  if (action === 'restore') {
    const { ok, data } = await apiRequest('POST', `/api/admin/users/${id}/restore`);
    if (ok) { showToast('Восстановлен', 'success'); loadUsers(); }
    else showToast(data.error, 'error');
  }
  if (action === 'edit') {
    const form = document.getElementById('edit-user-form');
    form.dataset.editId = id;
    form.querySelector('[name=name]').value  = name;
    form.querySelector('[name=email]').value = email;
    form.querySelector('[name=role]').value  = role;
    openModal('modal-edit-user');
  }
});

// ─── Делегирование: таблица выплат ───────────────────────────
document.getElementById('payouts-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="payout-status"]');
  if (!btn) return;
  const { id, status } = btn.dataset;
  const { ok, data } = await apiRequest('PUT', `/api/admin/partner-payouts/${id}`, { status });
  if (ok) { showToast('Статус обновлён', 'success'); loadPayouts(); }
  else showToast(data.error, 'error');
});

document.getElementById('create-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { ok, data } = await apiRequest('POST', '/api/admin/users', Object.fromEntries(fd.entries()));
  if (ok) { showToast('Пользователь создан', 'success'); closeModal('modal-create-user'); loadUsers(); }
  else showToast(data.error, 'error');
});

document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.editId;
  const body = { name: form.querySelector('[name=name]').value, email: form.querySelector('[name=email]').value, role: form.querySelector('[name=role]').value };
  const { ok, data } = await apiRequest('PUT', `/api/admin/users/${id}`, body);
  if (ok) { showToast('Сохранено', 'success'); closeModal('modal-edit-user'); loadUsers(); }
  else showToast(data.error, 'error');
});

// ─── Выплаты ─────────────────────────────────────────────────
async function loadPayouts() {
  const { ok, data } = await apiRequest('GET', '/api/admin/partner-payouts');
  if (!ok) return;

  const tbody = document.querySelector('#payouts-table tbody');
  tbody.innerHTML = data.data.map(p => `
    <tr>
      <td>${escHtml(p.partner_name)}<br><span class="text-muted" style="font-size:.8rem">${escHtml(p.partner_email)}</span></td>
      <td>${formatMoney(p.amount)}</td>
      <td style="max-width:200px;word-break:break-word;font-size:.85rem">${escHtml(p.payment_details)}</td>
      <td>${badge(p.status)}</td>
      <td>${formatDate(p.created_at)}</td>
      <td>
        ${p.status === 'pending' ? `
          <div class="flex gap-1">
            <button class="btn btn-sm btn-primary" data-action="payout-status" data-id="${p.id}" data-status="processing">В обработку</button>
            <button class="btn btn-sm btn-danger" data-action="payout-status" data-id="${p.id}" data-status="rejected">Отклонить</button>
          </div>` : ''}
        ${p.status === 'processing' ? `
          <button class="btn btn-sm btn-primary" data-action="payout-status" data-id="${p.id}" data-status="paid">Выплачено</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-muted">Запросов нет</td></tr>';
}

// ─── Кнопка «Создать пользователя» ───────────────────────────
document.getElementById('btn-create-user').addEventListener('click', () => {
  document.getElementById('create-user-form').reset();
  openModal('modal-create-user');
});

document.getElementById('projects-filter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loadProjects();
});

document.getElementById('btn-projects-filter-reset').addEventListener('click', async () => {
  const form = document.getElementById('projects-filter-form');
  form.reset();
  loadProjects();
});

document.getElementById('project-history-filter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loadProjectHistory();
});

document.getElementById('btn-history-filter-reset').addEventListener('click', async () => {
  const form = document.getElementById('project-history-filter-form');
  form.reset();
  loadProjectHistory();
});

init();
