const FUNNEL_COLS = ['lead','qualification','visit','offer','negotiation','contract','work','won','lost'];
const FUNNEL_NAMES = { lead:'Лид', qualification:'Квалификация', visit:'Выезд', offer:'КП',
  negotiation:'Переговоры', contract:'Договор', work:'В работе', won:'Завершён', lost:'Отказ' };

let currentUser = null;
let activeProjectId = null;
let activeRequestId = null;
let activeRequestData = null;
let staffList = [];
let docTypes = {};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('manager');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  initNotificationBell();
  await loadDocTypes();
  loadFunnel();
}

async function loadDocTypes() {
  const { ok, data } = await apiRequest('GET', '/api/manager/doc-types');
  if (!ok) return;
  docTypes = data.data;
  const sel = document.getElementById('doc-type-select');
  sel.innerHTML = '<option value="">— выберите тип —</option>' +
    Object.entries(docTypes).map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('');
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'requests') loadRequests();
  if (section === 'messages') loadMessages();
});

// ─── Воронка ─────────────────────────────────────────────────
async function loadFunnel() {
  const { ok, data } = await apiRequest('GET', '/api/manager/projects');
  if (!ok) return;

  const board = document.getElementById('kanban-board');
  const grouped = {};
  FUNNEL_COLS.forEach(s => grouped[s] = []);
  data.data.forEach(p => { if (grouped[p.status]) grouped[p.status].push(p); });

  board.innerHTML = FUNNEL_COLS.map(status => `
    <div class="kanban-col" data-col="${status}">
      <div class="kanban-col-title">${FUNNEL_NAMES[status]} <span style="color:var(--muted)">(${grouped[status].length})</span></div>
      ${grouped[status].map(p => `
        <div class="kanban-card" draggable="true" data-action="open-project" data-id="${p.id}" data-status="${p.status}">
          <div class="kanban-card-name">${escHtml(p.name)}</div>
          <div class="kanban-card-meta">${escHtml(p.code)}</div>
          ${p.contract_value ? `<div class="kanban-card-meta">${formatMoney(p.contract_value)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `).join('');

  initKanbanDragDrop();
}

function initKanbanDragDrop() {
  let dragId = null;

  document.querySelectorAll('.kanban-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '.4';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '';
    });
  });

  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.style.background = 'var(--surface-alt, rgba(255,255,255,.06))';
    });
    col.addEventListener('dragleave', () => {
      col.style.background = '';
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.style.background = '';
      const newStatus = col.dataset.col;
      if (!dragId || !newStatus) return;
      const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${dragId}`, { status: newStatus });
      if (ok) loadFunnel();
      else showToast(data.error, 'error');
    });
  });
}

document.getElementById('kanban-board').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  openProject(card.dataset.id);
});

async function openProject(id) {
  activeProjectId = id;

  const { ok, data } = await apiRequest('GET', `/api/manager/projects`);
  if (!ok) return;
  const project = data.data.find(p => p.id == id);
  if (!project) return;

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-info').innerHTML = `
    <div class="flex gap-2" style="flex-wrap:wrap">
      <span>${badge(project.status)}</span>
      <span class="text-muted" style="font-size:.85rem">${escHtml(project.code)}</span>
      ${project.address ? `<span class="text-muted" style="font-size:.85rem">📍 ${escHtml(project.address)}</span>` : ''}
      ${project.contract_value ? `<span class="text-muted" style="font-size:.85rem">${formatMoney(project.contract_value)}</span>` : ''}
    </div>
  `;
  document.getElementById('project-status-select').value = project.status;
  document.getElementById('analyze-result').textContent = '';

  await loadStaff();
  loadProjectDocs(id);
  document.getElementById('upload-doc-form').reset();
  openModal('modal-project');
}

document.getElementById('btn-save-status').addEventListener('click', async () => {
  const status = document.getElementById('project-status-select').value;
  const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${activeProjectId}`, { status });
  if (ok) { showToast('Статус обновлён', 'success'); loadFunnel(); closeModal('modal-project'); }
  else showToast(data.error, 'error');
});

// ─── Команда ─────────────────────────────────────────────────
const TEAM_ROLES = { foreman: 'foreman', pto: 'pto', supplier: 'supplier' };

async function loadStaff() {
  if (staffList.length === 0) {
    const { ok, data } = await apiRequest('GET', '/api/manager/staff');
    if (ok) staffList = data.data;
  }
  for (const [role, selId] of [['foreman','select-foreman'],['pto','select-pto'],['supplier','select-supplier']]) {
    const filtered = staffList.filter(u => u.role === role);
    document.getElementById(selId).innerHTML = filtered.length
      ? filtered.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')
      : `<option value="">— нет сотрудников —</option>`;
  }
}

document.getElementById('team-add-rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-add-role]');
  if (!btn) return;
  const role = btn.dataset.addRole;
  const sel = document.getElementById(`select-${role}`);
  const userId = parseInt(sel?.value);
  if (!userId) return showToast('Выберите сотрудника', 'error');
  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/team`, {
    user_id: userId,
    role: TEAM_ROLES[role],
  });
  if (ok) showToast('Участник добавлен', 'success');
  else showToast(data.error, 'error');
});

// ─── Документы ───────────────────────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }

  if (!data.data.length) {
    container.innerHTML = '<span style="color:var(--muted)">Документов нет</span>';
    return;
  }

  container.innerHTML = data.data.map(doc => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600">${escHtml(docTypes[doc.doc_type] || doc.doc_type)}</div>
        <div style="color:var(--muted);font-size:.8rem">${escHtml(doc.file_name)}${doc.description ? ' — ' + escHtml(doc.description) : ''}</div>
        <div style="color:var(--muted);font-size:.78rem">${formatDate(doc.uploaded_at)} · ${escHtml(doc.uploaded_by_name)}</div>
      </div>
      <div style="display:flex;gap:.4rem;flex-shrink:0;margin-left:.75rem">
        <a href="${doc.url}" target="_blank" class="btn btn-outline btn-sm" style="font-size:.78rem">Скачать</a>
        ${doc.uploaded_by_id === currentUser.id ? `<button class="btn btn-sm" style="font-size:.78rem;color:var(--muted);border:1px solid var(--border);background:transparent"
          data-action="delete-doc" data-id="${doc.id}">✕</button>` : ''}
      </div>
    </div>
  `).join('');
}

document.getElementById('project-docs-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-doc"]');
  if (!btn) return;
  if (!confirm('Удалить документ?')) return;
  const { ok, data } = await apiRequest('DELETE', `/api/manager/documents/${btn.dataset.id}`);
  if (ok) { showToast('Документ удалён', 'success'); loadProjectDocs(activeProjectId); }
  else showToast(data.error, 'error');
});

document.getElementById('upload-doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Загрузка...';

  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/documents`, fd);
  btn.disabled = false;
  btn.textContent = 'Загрузить';

  if (ok) {
    showToast('Документ загружен', 'success');
    e.target.reset();
    loadProjectDocs(activeProjectId);
  } else showToast(data.error, 'error');
});

// ─── AI-анализ ───────────────────────────────────────────────
document.getElementById('btn-analyze').addEventListener('click', async () => {
  const btn = document.getElementById('btn-analyze');
  const result = document.getElementById('analyze-result');
  btn.disabled = true;
  btn.textContent = 'Анализирую...';
  result.textContent = '';

  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/analyze`);
  if (ok) result.textContent = data.data.analysis;
  else showToast(data.error, 'error');

  btn.disabled = false;
  btn.textContent = 'Запустить анализ';
});

// ─── Создать проект ───────────────────────────────────────────
document.getElementById('btn-create-project').addEventListener('click', () => {
  document.getElementById('create-project-form').reset();
  openModal('modal-create-project');
});

document.getElementById('create-project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());

  delete body.work_types;
  const workTypes = Array.from(e.target.querySelectorAll('[name=work_types]:checked')).map(cb => cb.value);
  if (workTypes.length) body.work_types = workTypes;

  if (body.contract_value) body.contract_value = parseFloat(body.contract_value);
  else delete body.contract_value;

  for (const key of Object.keys(body)) {
    if (body[key] === '') delete body[key];
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', '/api/manager/projects', body);
  btn.disabled = false;

  if (ok) {
    showToast(`Проект ${data.data.code} создан`, 'success');
    closeModal('modal-create-project');
    e.target.reset();
    loadFunnel();
  } else showToast(data.error, 'error');
});

// ─── Заявки ──────────────────────────────────────────────────
async function loadRequests() {
  const { ok, data } = await apiRequest('GET', '/api/manager/requests');
  if (!ok) return;

  const tbody = document.querySelector('#requests-table tbody');
  tbody.innerHTML = data.data.map(r => `
    <tr>
      <td>${escHtml(r.name || '—')}</td>
      <td>${escHtml(r.phone || '')} ${escHtml(r.email || '')}</td>
      <td style="max-width:200px;font-size:.85rem">${escHtml((r.message || '').slice(0, 80))}${r.message?.length > 80 ? '...' : ''}</td>
      <td>${badge(r.status)}</td>
      <td>${formatDate(r.created_at)}</td>
      <td><button class="btn btn-sm btn-outline" data-action="open-request" data-id="${r.id}" data-status="${r.status}" data-name="${escHtml(r.name||'')}" data-phone="${escHtml(r.phone||'')}" data-email="${escHtml(r.email||'')}" data-message="${escHtml(r.message||'')}">Открыть</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-muted">Заявок нет</td></tr>';
}

document.getElementById('requests-table').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="open-request"]');
  if (!btn) return;
  const { id, status, name, phone, email, message } = btn.dataset;
  activeRequestId = id;
  activeRequestData = { name, phone, email, message };
  document.getElementById('modal-request-info').innerHTML = `
    <p><strong>Имя:</strong> ${escHtml(name || '—')}</p>
    <p><strong>Телефон:</strong> ${escHtml(phone || '—')}</p>
    <p><strong>Email:</strong> ${escHtml(email || '—')}</p>
    <p class="mt-2" style="font-size:.9rem;color:var(--muted)">${escHtml(message || '—')}</p>
  `;
  document.getElementById('request-status-select').value = status;
  openModal('modal-request');
});

document.getElementById('btn-request-to-project').addEventListener('click', () => {
  closeModal('modal-request');
  const form = document.getElementById('create-project-form');
  form.reset();
  if (activeRequestData) {
    const set = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el && val) el.value = val; };
    set('contact_name', activeRequestData.name);
    set('contact_phone', activeRequestData.phone);
    set('contact_email', activeRequestData.email);
    set('notes', activeRequestData.message);
    set('lead_source', 'сайт');
  }
  openModal('modal-create-project');
});

document.getElementById('btn-save-request').addEventListener('click', async () => {
  const status = document.getElementById('request-status-select').value;
  const { ok, data } = await apiRequest('PUT', `/api/manager/requests/${activeRequestId}`, { status });
  if (ok) { showToast('Сохранено', 'success'); closeModal('modal-request'); loadRequests(); }
  else showToast(data.error, 'error');
});

// ─── Сообщения ────────────────────────────────────────────────
async function loadMessages() {
  const { ok, data } = await apiRequest('GET', '/api/messages');
  if (!ok) return;

  const tbody = document.querySelector('#messages-table tbody');
  tbody.innerHTML = data.data.map(m => {
    const isOutbox = m.sender_id === currentUser.id;
    return `
      <tr>
        <td>${isOutbox ? `→ ${escHtml(m.receiver_name)}` : `← ${escHtml(m.sender_name)}`}</td>
        <td>${escHtml(m.subject || '(без темы)')}</td>
        <td>${formatDate(m.created_at)}</td>
        <td>${!isOutbox && !m.is_read ? '<span class="badge badge-blue">Новое</span>' : '<span class="badge badge-gray">Прочитано</span>'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" class="text-muted">Сообщений нет</td></tr>';
}

document.getElementById('btn-new-message').addEventListener('click', () => {
  document.getElementById('new-message-form').reset();
  openModal('modal-new-message');
});

document.getElementById('new-message-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());

  const { ok: uok, data: udata } = await apiRequest('GET', '/api/manager/staff');
  if (!uok) return showToast('Не удалось получить список сотрудников', 'error');
  const user = udata.data.find(u => u.email === body.receiver_email);
  if (!user) return showToast('Пользователь с таким email не найден', 'error');

  const { ok, data } = await apiRequest('POST', '/api/messages', {
    receiver_id: user.id,
    subject: body.subject || undefined,
    body: body.body,
  });
  if (ok) { showToast('Отправлено', 'success'); closeModal('modal-new-message'); loadMessages(); }
  else showToast(data.error, 'error');
});

init();
