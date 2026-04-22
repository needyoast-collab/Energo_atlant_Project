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
  if (section === 'users') loadUsers();
  if (section === 'projects') loadProjects();
  if (section === 'project-history') loadProjectHistory();
  if (section === 'payouts') loadPayouts();
  if (section === 'catalog') {
    // По умолчанию открываем работы
    switchTab('works');
    loadCatalog();
  }
});

// ─── Метрики ─────────────────────────────────────────────────
async function loadMetrics() {
  const { ok, data } = await apiRequest('GET', '/api/admin/metrics');
  if (!ok) return;

  const m = data.data;
  const totalUsers = m.users.reduce((s, r) => s + parseInt(r.count), 0);
  const totalProjects = m.projects.reduce((s, r) => s + parseInt(r.count), 0);
  const totalRequests = m.requests.reduce((s, r) => s + parseInt(r.count), 0);
  const totalPayouts = m.payouts.reduce((s, r) => s + parseInt(r.count), 0);

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

  const ROLE_LABELS = {
    admin: 'Администратор', manager: 'Менеджер', foreman: 'Прораб',
    supplier: 'Снабженец', pto: 'ПТО', customer: 'Заказчик', partner: 'Партнёр'
  };

  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = data.data.map(u => `
    <tr>
      <td>${escHtml(u.name)}</td>
      <td>${escHtml(u.email)}</td>
      <td>${ROLE_LABELS[u.role] || u.role}</td>
      <td>
        ${u.is_deleted ? '<span class="badge badge-red">Удалён</span>' :
      u.is_verified ? '<span class="badge badge-green">Активен</span>' :
        '<span class="badge badge-yellow">Не подтверждён</span>'}
      </td>
      <td>
        <div class="flex gap-1">
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
    form.querySelector('[name=name]').value = name;
    form.querySelector('[name=email]').value = email;
    form.querySelector('[name=role]').value = role;
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

// ─── Справочник работ ────────────────────────────────────────
async function loadCatalog() {
  const tbody = document.querySelector('#catalog-table tbody');
  const q = document.getElementById('catalog-search')?.value || '';
  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Загрузка...</td></tr>';
  
  const { ok, data } = await apiRequest('GET', `/api/admin/catalog?q=${encodeURIComponent(q)}`);
  if (!ok) return;

  tbody.innerHTML = data.data.map(c => `
    <tr>
      <td>
        ${!c.is_approved ? '<span style="color:var(--accent);margin-right:4px" title="Ожидает утверждения">❗</span>' : ''}
        ${escHtml(c.item_name)}
      </td>
      <td>${escHtml(c.unit)}</td>
      <td>${Number(c.base_price).toLocaleString('ru-RU')} ₽</td>
      <td>${c.is_approved ? '<span class="badge badge-green">Утверждено</span>' : '<span class="badge badge-yellow">Модерация</span>'}</td>
      <td>
        <div class="flex gap-1">
          ${!c.is_approved ? `<button class="btn btn-sm btn-primary" data-action="catalog-approve" data-id="${c.id}">Утвердить</button>` : ''}
          <button class="btn btn-sm btn-outline" data-action="catalog-edit" 
            data-id="${c.id}" 
            data-name="${escHtml(c.item_name)}" 
            data-unit="${escHtml(c.unit)}" 
            data-price="${c.base_price}">Редактировать</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-muted">Справочник работ пуст</td></tr>';
}

document.getElementById('catalog-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name, unit, price } = btn.dataset;

  if (action === 'catalog-approve') {
    const { ok } = await apiRequest('POST', `/api/admin/catalog/${id}/approve`);
    if (ok) { showToast('Утверждено', 'success'); loadCatalog(); }
  }
  if (action === 'catalog-edit') {
    const form = document.getElementById('edit-catalog-form');
    form.dataset.id = id;
    form.querySelector('[name=item_name]').value = name;
    form.querySelector('[name=unit]').value = unit;
    form.querySelector('[name=base_price]').value = price;
    openModal('modal-edit-catalog');
  }
});

document.getElementById('edit-catalog-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.dataset.id;
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const { ok } = await apiRequest('PUT', `/api/admin/catalog/${id}`, body);
  if (ok) { showToast('Сохранено', 'success'); closeModal('modal-edit-catalog'); loadCatalog(); }
});

document.getElementById('btn-catalog-delete-modal').addEventListener('click', async () => {
  const form = document.getElementById('edit-catalog-form');
  const id = form.dataset.id;
  if (!id) return;
  if (!confirm('Удалить позицию из справочника работ?')) return;

  const btn = document.getElementById('btn-catalog-delete-modal');
  btn.disabled = true;

  const { ok } = await apiRequest('DELETE', `/api/admin/catalog/${id}`);

  btn.disabled = false;

  if (ok) {
    showToast('Удалено', 'success');
    closeModal('modal-edit-catalog');
    loadCatalog();
  }
});

function addCatalogBatchRow() {
  const tbody = document.getElementById('catalog-batch-tbody');
  const rowNum = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:.3rem .5rem;color:var(--muted);font-size:.8rem;text-align:center">${rowNum}</td>
    <td style="padding:.2rem .3rem">
      <input type="text" class="catalog-batch-cell catalog-batch-name" placeholder="Наименование работы"
        style="width:100%;min-width:240px;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
    </td>
    <td style="padding:.2rem .3rem">
      <input type="text" class="catalog-batch-cell catalog-batch-unit" placeholder="шт, м, компл..."
        style="width:100%;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
    </td>
    <td style="padding:.2rem .3rem">
      <input type="number" class="catalog-batch-cell catalog-batch-price" placeholder="0" min="0" step="0.01"
        style="width:100%;min-width:90px;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
    </td>
  `;
  tbody.appendChild(tr);
  updateCatalogBatchState();
  return tr;
}

function updateCatalogBatchModalSize(rowsCount) {
  const modal = document.getElementById('catalog-batch-modal-box');
  if (!modal) return;
  const effectiveRows = Math.max(rowsCount, 5);
  const targetHeight = Math.min(88, 50 + effectiveRows * 4.6);
  modal.style.maxHeight = `${targetHeight}vh`;
}

function updateCatalogBatchState() {
  const rows = document.querySelectorAll('#catalog-batch-tbody tr');
  let filled = 0;
  rows.forEach((tr, index) => {
    tr.firstElementChild.textContent = index + 1;
    const name = tr.querySelector('.catalog-batch-name').value.trim();
    const unit = tr.querySelector('.catalog-batch-unit').value.trim();
    const priceValue = tr.querySelector('.catalog-batch-price').value;
    const price = parseFloat(String(priceValue).replace(',', '.'));
    if (name && unit && !Number.isNaN(price) && price >= 0) {
      filled++;
    }
  });
  const s = filled % 10 === 1 && filled % 100 !== 11 ? 'позиция' : filled % 10 >= 2 && filled % 10 <= 4 && (filled % 100 < 10 || filled % 100 >= 20) ? 'позиции' : 'позиций';
  document.getElementById('bulk-preview-count').textContent = `${filled} ${s} заполнено`;
  updateCatalogBatchModalSize(rows.length);
}

function resetCatalogBatchModal() {
  const tbody = document.getElementById('catalog-batch-tbody');
  tbody.innerHTML = '';
  for (let i = 0; i < 5; i++) addCatalogBatchRow();
  updateCatalogBatchState();
}

document.getElementById('btn-catalog-bulk-open').addEventListener('click', () => {
  resetCatalogBatchModal();
  openModal('modal-catalog-bulk');
  document.querySelector('#catalog-batch-tbody .catalog-batch-name')?.focus();
});

document.getElementById('modal-catalog-bulk').addEventListener('keydown', (e) => {
  const cell = e.target;
  if (!cell.classList.contains('catalog-batch-cell')) return;
  if (e.key !== 'Tab' && e.key !== 'Enter') return;
  e.preventDefault();

  const cells = [...document.getElementById('modal-catalog-bulk').querySelectorAll('.catalog-batch-cell')];
  const idx = cells.indexOf(cell);
  if (idx === cells.length - 1) {
    const tr = addCatalogBatchRow();
    tr.querySelector('.catalog-batch-name').focus();
    return;
  }

  cells[idx + 1].focus();
});

document.getElementById('modal-catalog-bulk').addEventListener('focusin', (e) => {
  if (e.target.classList.contains('catalog-batch-cell')) {
    e.target.style.borderColor = '#F5A623';
  }
});

document.getElementById('modal-catalog-bulk').addEventListener('focusout', (e) => {
  if (e.target.classList.contains('catalog-batch-cell')) {
    e.target.style.borderColor = 'var(--border)';
  }
});

document.getElementById('catalog-batch-tbody').addEventListener('input', updateCatalogBatchState);

document.getElementById('modal-catalog-bulk').addEventListener('paste', (e) => {
  const cell = e.target;
  if (!cell.classList.contains('catalog-batch-cell')) return;
  e.preventDefault();

  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;

  const pasteRows = text.trim().split(/\r?\n/).map((row) => row.split('\t'));
  const tbody = document.getElementById('catalog-batch-tbody');
  const allRows = [...tbody.querySelectorAll('tr')];
  const currentRow = cell.closest('tr');
  let startIdx = allRows.indexOf(currentRow);
  if (startIdx === -1) startIdx = 0;

  pasteRows.forEach((cols, rowIndex) => {
    let tr = allRows[startIdx + rowIndex];
    if (!tr) {
      tr = addCatalogBatchRow();
      allRows.push(tr);
    }

    if (cols[0] !== undefined) tr.querySelector('.catalog-batch-name').value = cols[0].trim();
    if (cols[1] !== undefined) tr.querySelector('.catalog-batch-unit').value = cols[1].trim();
    if (cols[2] !== undefined) {
      const price = parseFloat(cols[2].replace(/\s/g, '').replace(',', '.'));
      if (!Number.isNaN(price)) {
        tr.querySelector('.catalog-batch-price').value = price;
      }
    }
  });

  updateCatalogBatchState();
});

document.getElementById('btn-catalog-batch-add-row').addEventListener('click', () => {
  const tr = addCatalogBatchRow();
  tr.querySelector('.catalog-batch-name').focus();
});

document.getElementById('catalog-bulk-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const items = [];
  document.querySelectorAll('#catalog-batch-tbody tr').forEach((tr) => {
    const item_name = tr.querySelector('.catalog-batch-name').value.trim();
    const unit = tr.querySelector('.catalog-batch-unit').value.trim();
    const basePriceRaw = tr.querySelector('.catalog-batch-price').value;
    const base_price = parseFloat(String(basePriceRaw).replace(',', '.'));

    if (item_name && unit && !Number.isNaN(base_price) && base_price >= 0) {
      items.push({ item_name, unit, base_price });
    }
  });

  if (!items.length) {
    showToast('Заполните хотя бы одну позицию', 'error');
    return;
  }

  const btn = document.getElementById('btn-catalog-batch-save');
  btn.disabled = true;
  btn.textContent = 'Импорт...';

  const { ok, data } = await apiRequest('POST', '/api/admin/catalog/bulk', { items });

  btn.disabled = false;
  btn.textContent = 'Импортировать в базу';

  if (ok) {
    showToast(data.message || 'Импорт завершён', 'success');
    closeModal('modal-catalog-bulk');
    loadCatalog();
  } else {
    showToast(data.error || 'Ошибка импорта', 'error');
  }
});

// ─── Коэффициенты ───
async function loadCoefficients() {
  const tbody = document.querySelector('#coeffs-table tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', '/api/admin/coefficients');
  if (!ok) return;

  tbody.innerHTML = data.data.map(c => `
    <tr>
      <td>${escHtml(c.name)}</td>
      <td>${Number(c.value).toFixed(3)}</td>
      <td class="text-muted" style="font-size:.82rem">${escHtml(c.description || '—')}</td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-sm btn-outline" data-action="coeff-edit" 
            data-id="${c.id}" data-name="${escHtml(c.name)}" 
            data-value="${c.value}" data-desc="${escHtml(c.description || '')}">✎</button>
          <button class="btn btn-sm btn-danger" data-action="coeff-delete" data-id="${c.id}">✕</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">Коэффициенты не заданы</td></tr>';
}

document.getElementById('coeffs-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name, value, desc } = btn.dataset;

  if (action === 'coeff-delete') {
    if (!confirm('Удалить коэффициент?')) return;
    const { ok } = await apiRequest('DELETE', `/api/admin/coefficients/${id}`);
    if (ok) { showToast('Удалено', 'success'); loadCoefficients(); }
  }
  if (action === 'coeff-edit') {
    const form = document.getElementById('edit-coeff-form');
    form.dataset.id = id;
    document.getElementById('coeff-modal-title').textContent = 'Редактировать коэффициент';
    form.querySelector('[name=name]').value = name;
    form.querySelector('[name=value]').value = value;
    form.querySelector('[name=description]').value = desc;
    openModal('modal-edit-coeff');
  }
});

document.getElementById('btn-coeff-create').addEventListener('click', () => {
  const form = document.getElementById('edit-coeff-form');
  form.dataset.id = '';
  document.getElementById('coeff-modal-title').textContent = 'Создать коэффициент';
  form.reset();
  openModal('modal-edit-coeff');
});

document.getElementById('edit-coeff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.dataset.id;
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/admin/coefficients/${id}` : '/api/admin/coefficients';
  
  const { ok, data } = await apiRequest(method, url, body);
  if (ok) {
    showToast('Сохранено', 'success');
    closeModal('modal-edit-coeff');
    loadCoefficients();
  } else {
    showToast(data.error || 'Ошибка', 'error');
  }
});

// ─── Табы ────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${tab}`);
  });
  if (tab === 'works') loadCatalog();
  if (tab === 'coeffs') loadCoefficients();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Живой поиск в справочнике с дебаунсом
let catalogSearchTimeout;
document.getElementById('catalog-search')?.addEventListener('input', (e) => {
  clearTimeout(catalogSearchTimeout);
  catalogSearchTimeout = setTimeout(() => loadCatalog(), 500);
});
