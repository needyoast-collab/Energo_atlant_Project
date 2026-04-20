const FUNNEL_COLS = ['lead', 'qualification', 'visit', 'offer', 'negotiation', 'contract', 'work', 'won', 'lost'];
const FUNNEL_NAMES = {
  lead: 'Лид', qualification: 'Квалификация', visit: 'Выезд', offer: 'КП',
  negotiation: 'Переговоры', contract: 'Договор', work: 'В работе', won: 'Завершён', lost: 'Отказ'
};

const STATUS_COLORS = {
  lead: '#6b7280', qualification: '#6b7280', visit: '#3b82f6',
  offer: '#f59e0b', negotiation: '#f97316', contract: '#8b5cf6',
  work: '#3b82f6', won: '#22c55e', lost: '#ef4444',
};

const PROGRESS_COLORS = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
};

const PROGRESS_LABELS = {
  green: 'Завершён',
  yellow: 'В работе',
  red: 'Не начат',
};

const STAGE_NAMES = {
  planned: 'Запланировано',
  done: 'Выполнено',
  not_done: 'Не выполнено',
  pending: 'Запланировано',
  in_progress: 'В работе',
};

let currentUser = null;
let activeProjectId = null;
let activeProject = null;
let activeRequestId = null;
let activeRequestData = null;
let requestIdForProject = null;
let staffList = [];
let docTypes = {};
let activeWorkSpecEditId = null;

const REQUEST_DOC_LABELS = {
  tu: 'Технические условия', rd: 'Рабочая документация',
  pd: 'Проектная документация', tz: 'Техническое задание',
  situation_plan: 'Ситуационный план', other: 'Прочее',
};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('manager');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  initNotificationBell();
  initCatalogAutocomplete('manager');
  await loadDocTypes();
  loadRequests();
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
  if (section === 'funnel') loadFunnel();
  if (section === 'projects') loadProjects();
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
    card.addEventListener('dragend', () => { card.style.opacity = ''; });
  });

  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.style.background = 'var(--surface-alt, rgba(255,255,255,.06))';
    });
    col.addEventListener('dragleave', () => { col.style.background = ''; });
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

document.getElementById('kanban-board').addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  openProject(card.dataset.id);
});

// ─── Проекты (таблица) ────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/manager/projects');
  if (!ok) return;

  const tbody = document.querySelector('#projects-table tbody');
  if (!tbody) return;
  const getProgress = (p) => {
    if (p.progress_color) return p.progress_color;
    if (p.status === 'won') return 'green';
    if ((p.stage_total || 0) > 0 && p.stage_done === p.stage_total) return 'green';
    if ((p.stage_done || 0) > 0) return 'yellow';
    return 'red';
  };

  tbody.innerHTML = data.data.map(p => `
    <tr style="cursor:pointer" data-action="open-project" data-id="${p.id}">
      <td style="white-space:nowrap">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${PROGRESS_COLORS[getProgress(p)]};vertical-align:middle;margin-right:6px"></span>
        <span style="font-size:.8rem;color:var(--muted)">${PROGRESS_LABELS[getProgress(p)]}</span>
      </td>
      <td style="font-size:.82rem;color:var(--muted)">${escHtml(p.code)}</td>
      <td style="font-weight:600">${escHtml(p.name)}</td>
      <td>${badge(p.status)}</td>
      <td style="font-size:.83rem;color:var(--muted)">${escHtml(p.address || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Проектов нет</td></tr>';
}

document.getElementById('projects-table').addEventListener('click', (e) => {
  const row = e.target.closest('[data-action="open-project"]');
  if (!row) return;
  openProject(row.dataset.id);
});

// ─── Проект (модалка табы) ────────────────────────────────────
async function openProject(id) {
  activeProjectId = id;

  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}`);
  if (!ok) return;
  const project = data.data;
  activeProject = project;

  const workTypes = (() => {
    if (!project.work_types) return '—';
    try {
      const parsed = typeof project.work_types === 'string'
        ? JSON.parse(project.work_types)
        : project.work_types;
      return Array.isArray(parsed) && parsed.length ? parsed.map(escHtml).join(', ') : '—';
    } catch {
      return escHtml(String(project.work_types));
    }
  })();

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-info').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem">
      <div><span class="text-muted">Название:</span> <strong>${escHtml(project.name)}</strong></div>
      <div><span class="text-muted">Код:</span> ${escHtml(project.code)}</div>
      <div><span class="text-muted">Статус:</span> ${badge(project.status)}</div>
      <div><span class="text-muted">Адрес:</span> ${escHtml(project.address || '—')}</div>
      <div><span class="text-muted">Тип объекта:</span> ${escHtml(project.object_type || '—')}</div>
      <div><span class="text-muted">Класс напряжения:</span> ${escHtml(project.voltage_class || '—')}</div>
      <div><span class="text-muted">Закупка материалов (ВОМ):</span> <strong>${project.include_materials ? 'Требуется' : 'Не требуется'}</strong></div>
      <div style="grid-column:1/-1"><span class="text-muted">Виды работ:</span> ${workTypes}</div>
      <div><span class="text-muted">Контакт:</span> ${escHtml(project.contact_name || '—')}</div>
      <div><span class="text-muted">Телефон:</span> ${escHtml(project.contact_phone || '—')}</div>
      <div><span class="text-muted">Email:</span> ${escHtml(project.contact_email || '—')}</div>
      <div><span class="text-muted">Организация:</span> ${escHtml(project.contact_org || '—')}</div>
    </div>
  `;
  document.getElementById('project-status-select').value = project.status;
  document.getElementById('project-regional-coeff').value = project.regional_coeff || 1.0;
  document.getElementById('analyze-result').textContent = '';
  document.getElementById('upload-doc-form').reset();
  document.getElementById('vor-add-form').reset();
  document.getElementById('vor-add-form').style.display = 'none';
  activeWorkSpecEditId = null;

  const generateBtn = document.getElementById('btn-generate-stages');
  const generated = !!project.stages_generated;
  generateBtn.disabled = generated;
  generateBtn.style.display = generated ? 'none' : '';

  // Проверка готовности ВОР/ВОМ (простая логика: если они есть, можно строить КП)
  const kpBtn = document.getElementById('btn-open-kp');
  // Мы можем запрашивать кол-во, но покажем кнопку всегда, а при клике сделаем проверки
  kpBtn.style.display = ['offer', 'negotiation', 'contract', 'lead', 'visit', 'qualification'].includes(project.status) ? '' : 'none';

  await loadStaff();
  switchProjectTab('main');
  openModal('modal-project');
}

function switchProjectTab(tab) {
  document.querySelectorAll('.project-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.project-tab-panel').forEach(panel => {
    panel.style.display = panel.id === `ptab-${tab}` ? '' : 'none';
  });
  if (tab === 'stages') loadManagerStages(activeProjectId);
  if (tab === 'vor') loadManagerVOR(activeProjectId);
  if (tab === 'vom') loadManagerSpecs(activeProjectId);
  if (tab === 'warehouse') loadManagerWarehouse(activeProjectId);
  if (tab === 'documents') loadProjectDocs(activeProjectId);
}

document.getElementById('modal-project').addEventListener('click', (e) => {
  const tab = e.target.closest('.project-tab');
  if (tab) switchProjectTab(tab.dataset.tab);
});

document.getElementById('btn-save-status').addEventListener('click', async () => {
  const status = document.getElementById('project-status-select').value;
  const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${activeProjectId}`, { status });
  if (ok) {
    showToast('Статус обновлён', 'success');
    await loadFunnel();
    await loadProjects();
    await openProject(activeProjectId);
  }
  else showToast(data.error, 'error');
});

// ─── Команда ─────────────────────────────────────────────────
const TEAM_ROLES = { foreman: 'foreman', pto: 'pto', supplier: 'supplier' };

async function loadStaff() {
  if (staffList.length === 0) {
    const { ok, data } = await apiRequest('GET', '/api/manager/staff');
    if (ok) staffList = data.data;
  }
  for (const [role, selId] of [['foreman', 'select-foreman'], ['pto', 'select-pto'], ['supplier', 'select-supplier']]) {
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
    user_id: userId, role: TEAM_ROLES[role],
  });
  if (ok) showToast('Участник добавлен', 'success');
  else showToast(data.error, 'error');
});

document.getElementById('project-regional-coeff').addEventListener('change', async (e) => {
  const val = parseFloat(e.target.value);
  if (isNaN(val) || val <= 0) return;
  const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${activeProjectId}`, { regional_coeff: val });
  if (ok) {
    showToast('Коэффициент обновлён', 'success');
    activeProject.regional_coeff = val;
    if (document.getElementById('project-status-select').value) {
      loadManagerVOR(activeProjectId); // перерисуем ВОР чтобы обновить суммы
    }
  } else showToast(data.error, 'error');
});

// ─── Этапы ───────────────────────────────────────────────────
async function loadManagerStages(id) {
  const container = document.getElementById('stages-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/stages`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Этапов нет</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table style="width:100%;font-size:.875rem">
        <thead><tr>
          <th style="color:var(--muted);font-weight:500;width:2.5rem">#</th>
          <th style="color:var(--muted);font-weight:500">Название</th>
          <th style="color:var(--muted);font-weight:500">Статус</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">План</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Факт</th>
          <th style="color:var(--muted);font-weight:500">План дата</th>
          <th style="color:var(--muted);font-weight:500">Факт дата</th>
          <th style="color:var(--muted);font-weight:500">Примечание</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${data.data.map(s => `
            <tr>
              <td style="color:var(--muted)">${s.order_num}</td>
              <td>${escHtml(s.name)}</td>
              <td>${badge(STAGE_NAMES[s.status] || s.status)}</td>
              <td style="text-align:right">${s.planned_value ?? '—'}</td>
              <td style="text-align:right">${s.actual_value ?? '—'}</td>
              <td style="color:var(--muted);font-size:.82rem">${s.planned_date ? formatDate(s.planned_date) : '—'}</td>
              <td style="color:var(--muted);font-size:.82rem">${s.actual_date ? formatDate(s.actual_date) : '—'}</td>
              <td style="max-width:180px;font-size:.8rem;color:var(--muted)">${escHtml(s.note || '—')}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-outline btn-sm" style="font-size:.75rem"
                  data-action="edit-stage" data-id="${s.id}"
                  data-name="${escHtml(s.name)}" data-status="${s.status}"
                  data-order="${s.order_num ?? ''}"
                  data-start="${s.planned_start || ''}" data-end="${s.planned_end || ''}"
                  data-planned-value="${s.planned_value ?? ''}"
                  data-actual-value="${s.actual_value ?? ''}"
                  data-planned-date="${s.planned_date || ''}"
                  data-actual-date="${s.actual_date || ''}"
                  data-note="${escHtml(s.note || '')}">Ред.</button>
                <button class="btn btn-sm" style="font-size:.75rem;color:var(--muted);border:1px solid var(--border);background:transparent;margin-left:.25rem"
                  data-action="delete-stage" data-id="${s.id}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById('stages-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  if (btn.dataset.action === 'edit-stage') {
    document.getElementById('stage-modal-title').textContent = 'Редактировать этап';
    document.getElementById('stage-form-id').value = btn.dataset.id;
    document.getElementById('stage-form-name').value = btn.dataset.name;
    document.getElementById('stage-form-status').value = btn.dataset.status || 'planned';
    document.getElementById('stage-form-order').value = btn.dataset.order || '';
    document.getElementById('stage-form-start').value = btn.dataset.start;
    document.getElementById('stage-form-end').value = btn.dataset.end;
    document.getElementById('stage-form-planned-value').value = btn.dataset.plannedValue || '';
    document.getElementById('stage-form-actual-value').value = btn.dataset.actualValue || '';
    document.getElementById('stage-form-planned-date').value = btn.dataset.plannedDate || '';
    document.getElementById('stage-form-actual-date').value = btn.dataset.actualDate || '';
    document.getElementById('stage-form-note').value = btn.dataset.note || '';
    openModal('modal-manager-stage');
  }

  if (btn.dataset.action === 'delete-stage') {
    if (!confirm('Удалить этап?')) return;
    const { ok, data } = await apiRequest('DELETE', `/api/manager/stages/${btn.dataset.id}`);
    if (ok) { showToast('Этап удалён', 'success'); loadManagerStages(activeProjectId); }
    else showToast(data.error, 'error');
  }
});

document.getElementById('btn-add-stage').addEventListener('click', () => {
  document.getElementById('stage-modal-title').textContent = 'Новый этап';
  document.getElementById('stage-form').reset();
  document.getElementById('stage-form-id').value = '';
  document.getElementById('stage-form-status').value = 'planned';
  openModal('modal-manager-stage');
});

document.getElementById('stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const stageId = document.getElementById('stage-form-id').value;
  const body = {
    name: document.getElementById('stage-form-name').value,
    status: document.getElementById('stage-form-status').value,
    order_num: document.getElementById('stage-form-order').value ? parseInt(document.getElementById('stage-form-order').value, 10) : undefined,
    planned_start: document.getElementById('stage-form-planned-start').value || null,
    planned_end: document.getElementById('stage-form-planned-end').value || null,
    actual_date: document.getElementById('stage-form-actual-date').value || null,
    note: document.getElementById('stage-form-note').value || ''
  };

  const method = stageId ? 'PUT' : 'POST';
  const url = stageId ? `/api/manager/stages/${stageId}` : `/api/manager/projects/${activeProjectId}/stages`;

  const { ok, data } = await apiRequest(method, url, body);
  if (ok) {
    showToast(stageId ? 'Этап обновлён' : 'Этап создан', 'success');
    closeModal('modal-manager-stage');
    loadManagerStages(activeProjectId);
  } else {
    showToast(data.error, 'error');
  }
});

// ─── ВОР ─────────────────────────────────────────────────────
function renderVorRow(ws) {
  const price = ws.manager_price ? Number(ws.manager_price) : 0;
  const rCoeff = Number(activeProject.regional_coeff || 1.0);
  const sum = price * Number(ws.quantity) * rCoeff;
  const sumStr = sum ? sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽' : '—';

  return `
    <tr>
      <td>${escHtml(ws.work_name)}</td>
      <td style="text-align:right">${ws.quantity}</td>
      <td style="color:var(--muted)">${escHtml(ws.unit || '—')}</td>
      <td style="text-align:right;font-weight:500">${price ? price.toLocaleString('ru-RU') + ' ₽' : '<span style="color:red">Не задана</span>'}</td>
      <td style="text-align:right;font-weight:600">${sumStr}</td>
      <td>
        <button class="btn btn-outline btn-sm" style="font-size:.75rem;margin-right:.25rem"
          data-action="edit-vor"
          data-id="${ws.id}"
          data-work-name="${escHtml(ws.work_name)}"
          data-unit="${escHtml(ws.unit || '')}"
          data-quantity="${ws.quantity}"
          data-price="${ws.manager_price || ''}">Ред.</button>
        <button class="btn btn-sm" style="font-size:.75rem;color:var(--muted);border:1px solid var(--border);background:transparent"
          data-action="delete-vor" data-id="${ws.id}">✕</button>
      </td>
    </tr>
  `;
}

async function loadManagerVOR(id) {
  const container = document.getElementById('vor-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/work-specs`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">ВОР пустой</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table style="width:100%;font-size:.875rem">
        <thead><tr>
          <th style="color:var(--muted);font-weight:500">Вид работ</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Количество</th>
          <th style="color:var(--muted);font-weight:500">Ед.</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Цена за ед.</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Сумма</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${data.data.map(renderVorRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById('vor-list').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-action="edit-vor"]');
  if (editBtn) {
    const form = document.getElementById('vor-add-form');
    form.style.display = '';
    form.querySelector('[name="work_name"]').value = editBtn.dataset.workName || '';
    form.querySelector('[name="quantity"]').value = editBtn.dataset.quantity || '';
    form.querySelector('[name="unit"]').value = editBtn.dataset.unit || '';
    form.querySelector('[name="manager_price"]').value = editBtn.dataset.price || '';
    activeWorkSpecEditId = editBtn.dataset.id;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Сохранить';
    return;
  }

  const btn = e.target.closest('[data-action="delete-vor"]');
  if (!btn) return;
  if (!confirm('Удалить позицию ВОР?')) return;
  const { ok, data } = await apiRequest('DELETE', `/ api / manager / work - specs / ${btn.dataset.id} `);
  if (ok) { showToast('Позиция удалена', 'success'); loadManagerVOR(activeProjectId); }
  else showToast(data.error, 'error');
});

document.getElementById('btn-add-vor').addEventListener('click', () => {
  const form = document.getElementById('vor-add-form');
  activeWorkSpecEditId = null;
  form.reset();
  form.querySelector('button[type="submit"]').textContent = 'Добавить';
  form.style.display = form.style.display === 'none' ? '' : 'none';
});

document.getElementById('btn-cancel-vor').addEventListener('click', () => {
  activeWorkSpecEditId = null;
  const form = document.getElementById('vor-add-form');
  form.reset();
  form.querySelector('button[type="submit"]').textContent = 'Добавить';
  document.getElementById('vor-add-form').style.display = 'none';
});

document.getElementById('vor-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    work_name: fd.get('work_name'),
    quantity: parseFloat(fd.get('quantity')),
  };
  if (fd.get('unit')) body.unit = fd.get('unit');
  if (fd.get('manager_price')) body.manager_price = parseFloat(fd.get('manager_price'));

  const isEdit = !!activeWorkSpecEditId;
  const { ok, data } = isEdit
    ? await apiRequest('PUT', `/ api / manager / work - specs / ${activeWorkSpecEditId} `, body)
    : await apiRequest('POST', `/ api / manager / projects / ${activeProjectId}/work-specs`, body);
  if (ok) {
    showToast(isEdit ? 'Позиция обновлена' : 'Позиция добавлена', 'success');
    e.target.reset();
    document.getElementById('vor-add-form').style.display = 'none';
    e.target.querySelector('button[type="submit"]').textContent = 'Добавить';
    activeWorkSpecEditId = null;
    loadManagerVOR(activeProjectId);
  } else showToast(data.error, 'error');
});

document.getElementById('btn-generate-stages').addEventListener('click', async () => {
  if (!confirm('Сформировать этапы из ВОР? Это действие нельзя отменить.')) return;
  const btn = document.getElementById('btn-generate-stages');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/stages/generate-from-vor`);
  btn.disabled = false;
  if (ok) showToast(`Создано этапов: ${data.data.length}`, 'success');
  else showToast(data.error, 'error');
});

// ─── ВОМ (read-only) ─────────────────────────────────────────
async function loadManagerSpecs(id) {
  const container = document.getElementById('vom-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/specs`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Ведомость материалов пуста</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table style="width:100%;font-size:.875rem">
        <thead><tr>
          <th style="color:var(--muted);font-weight:500">Материал</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Кол-во</th>
          <th style="color:var(--muted);font-weight:500">Ед.</th>
          <th style="color:var(--muted);font-weight:500">Статус</th>
          <th style="color:var(--muted);font-weight:500">Снабженец</th>
        </tr></thead>
        <tbody>
          ${data.data.map(s => `
            <tr>
              <td>${escHtml(s.material_name)}</td>
              <td style="text-align:right">${s.quantity}</td>
              <td style="color:var(--muted)">${escHtml(s.unit || '—')}</td>
              <td>${badge(s.status)}</td>
              <td style="color:var(--muted);font-size:.8rem">${escHtml(s.supplier_name || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Склад (read-only) ────────────────────────────────────────
async function loadManagerWarehouse(id) {
  const container = document.getElementById('manager-warehouse-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/warehouse`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Склад объекта пуст</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table style="width:100%;font-size:.875rem">
        <thead><tr>
          <th style="color:var(--muted);font-weight:500">Материал</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Поступило</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Списано</th>
          <th style="color:var(--muted);font-weight:500;text-align:right">Остаток</th>
          <th style="color:var(--muted);font-weight:500">Ед.</th>
          <th style="color:var(--muted);font-weight:500">Источник</th>
        </tr></thead>
        <tbody>
          ${data.data.map(item => `
            <tr>
              <td>${escHtml(item.material_name)}</td>
              <td style="text-align:right">${item.qty_total}</td>
              <td style="text-align:right">${item.qty_used}</td>
              <td style="text-align:right;font-weight:600">${item.qty_balance}</td>
              <td style="color:var(--muted)">${escHtml(item.unit || '—')}</td>
              <td style="color:var(--muted);font-size:.8rem">${escHtml(item.source)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Документы ───────────────────────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Документов нет</span>'; return; }

  container.innerHTML = data.data.map(doc => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600">${escHtml(docTypes[doc.doc_type] || doc.doc_type)}</div>
        <div style="color:var(--muted);font-size:.8rem">${escHtml(doc.file_name)}${doc.description ? ' — ' + escHtml(doc.description) : ''}</div>
        <div style="color:var(--muted);font-size:.78rem">${formatDate(doc.uploaded_at)} · ${escHtml(doc.uploaded_by_name)}</div>
      </div>
      <div style="display:flex;gap:.4rem;flex-shrink:0;margin-left:.75rem">
        <a href="${doc.url}" target="_blank" class="btn btn-outline btn-sm" style="font-size:.78rem">Скачать</a>
        ${doc.uploaded_by_id === currentUser.id
      ? `<button class="btn btn-sm" style="font-size:.78rem;color:var(--muted);border:1px solid var(--border);background:transparent"
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
  btn.disabled = true; btn.textContent = 'Загрузка...';
  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/documents`, fd);
  btn.disabled = false; btn.textContent = 'Загрузить';
  if (ok) { showToast('Документ загружен', 'success'); e.target.reset(); loadProjectDocs(activeProjectId); }
  else showToast(data.error, 'error');
});

// ─── ФУНКЦИЯ СУММЫ ПРОПИСЬЮ ──────────────────────────────────────
function numberToWordsRu(num) {
  if (num === 0) return 'ноль';
  const units = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const units_f = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const forms = [
    ['', '', ''],
    ['тысяча', 'тысячи', 'тысяч'],
    ['миллион', 'миллиона', 'миллионов'],
    ['миллиард', 'миллиарда', 'миллиардов']
  ];
  let n = Math.floor(num);
  let words = [];
  let group = 0;

  function getPlural(n, formArr) {
    let n10 = n % 10;
    let n100 = n % 100;
    if (n100 > 10 && n100 < 20) return formArr[2];
    if (n10 > 1 && n10 < 5) return formArr[1];
    if (n10 === 1) return formArr[0];
    return formArr[2];
  }

  while (n > 0) {
    let chunk = n % 1000;
    if (chunk !== 0) {
      let chunkWords = [];
      let h = Math.floor(chunk / 100);
      let t = Math.floor((chunk % 100) / 10);
      let u = chunk % 10;

      if (h > 0) chunkWords.push(hundreds[h]);
      if (t === 1) {
        chunkWords.push(teens[u]);
      } else {
        if (t > 1) chunkWords.push(tens[t]);
        if (u > 0) chunkWords.push(group === 1 ? units_f[u] : units[u]);
      }
      let form = getPlural(chunk, forms[group]);
      if (form) chunkWords.push(form);
      words = chunkWords.concat(words);
    }
    n = Math.floor(n / 1000);
    group++;
  }
  return words.join(' ').trim();
}

// ─── ФОРМИРОВАНИЕ И ОТПРАВКА КП ────────────────────────────────
let currentKpData = null;

document.getElementById('btn-open-kp').addEventListener('click', async () => {
  const container = document.getElementById('kp-preview-content');
  container.innerHTML = '<span style="color:var(--muted)">Сбор данных для КП...</span>';
  document.getElementById('kp-markup-input').value = '0';
  document.getElementById('kp-final-sum-label').textContent = '0';
  document.getElementById('kp-manual-file').value = '';

  openModal('modal-generate-kp');

  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${activeProjectId}/kp-data`);
  if (!ok) { container.innerHTML = `<span style="color:red">Ошибка: ${data.error}</span>`; return; }

  const payload = data.data;
  if (!payload.works.length && payload.project.include_materials && !payload.materials.length) {
    container.innerHTML = '<strong>ВОР и ВОМ пусты. Сначала заполните их.</strong>';
    return;
  }
  if (!payload.works.length && !payload.project.include_materials) {
    container.innerHTML = '<strong>ВОР пустой. Заполните работы перед формированием КП.</strong>';
    return;
  }

  // Считаем суммы
  let worksTotal = 0;
  payload.works.forEach(w => {
    w.total = parseFloat((w.quantity * w.base_price).toFixed(2));
    worksTotal += w.total;
  });

  let materialsTotal = 0;
  payload.materials.forEach(m => {
    m.total = parseFloat((m.quantity * m.base_price).toFixed(2));
    materialsTotal += m.total;
  });

  const baseSum = parseFloat((worksTotal + materialsTotal).toFixed(2));

  currentKpData = {
    date: new Date().toLocaleDateString('ru-RU'),
    customerName: payload.project.contact_name || payload.project.customer_name || 'Не указан',
    projectName: payload.project.name,
    projectAddress: payload.project.address || 'Не указан',
    projectCode: payload.project.code,
    include_materials: payload.project.include_materials,
    works: payload.works,
    materials: payload.materials,
    worksTotal,
    materialsTotal,
    baseSum,
    baseSumWords: numberToWordsRu(baseSum),
    finalSum: baseSum,
    finalSumWords: numberToWordsRu(baseSum)
  };

  renderKpPreview();
});

function renderKpPreview() {
  if (!currentKpData) return;
  const markup = parseFloat(document.getElementById('kp-markup-input').value) || 0;
  currentKpData.finalSum = parseFloat((currentKpData.baseSum + markup).toFixed(2));
  currentKpData.finalSumWords = numberToWordsRu(currentKpData.finalSum);

  document.getElementById('kp-final-sum-label').textContent = formatMoney(currentKpData.finalSum);

  const container = document.getElementById('kp-preview-content');
  container.innerHTML = `
    <div style="font-family: serif; font-size: 1rem; line-height: 1.5; color: #000; padding: 1.5rem; background: #fff; border: 1px solid var(--border); border-radius: 8px;">
      <div style="text-align:right; font-size: 0.9rem; margin-bottom: 2rem;">
        Дата: <strong>${currentKpData.date}</strong>
      </div>
      <h2 style="text-align:center; margin-bottom:1.5rem; font-size:1.2rem; text-transform:uppercase;">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h2>
      
      <p style="text-indent: 1.5rem; text-align: justify; margin-bottom: 1rem;">
        ИП Большакова Е.Ф. рассмотрело техническое задание на выполнение строительно-монтажных работ по <strong>"${escHtml(currentKpData.projectName)}"</strong> по адресу <strong>${escHtml(currentKpData.projectAddress)}</strong> и готово принять данный объём в работу в полном соответствии с предъявленными требованиями.
      </p>

      <p style="margin-bottom: 0.5rem;"><strong>Стоимость и условия:</strong></p>
      <p style="margin-bottom: 0.5rem; text-indent: 1.5rem; text-align: justify;">
        Общая стоимость работ составляет <strong>${formatMoney(currentKpData.finalSum)}</strong> (<strong>${currentKpData.finalSumWords}</strong>) руб., включая НДС 20%.
      </p>
      <p style="text-indent: 1.5rem; margin-bottom: 2rem;">
        Детальная ведомость объемов работ ${currentKpData.materials.length > 0 || currentKpData.include_materials ? 'и материалов ' : ''}с разбивкой по позициям прилагается.
      </p>
      
      <div style="font-size: 0.85rem; color: var(--muted); border-top: 1px dashed #ccc; padding-top: 1rem;">
        <em>* Предпросмотр текста. Итоговый файл будет сформирован в вашем официальном оформлении из Word-шаблона. Таблицы ВОР также будут добавлены в виде приложения на следующие страницы.</em>
      </div>
    </div>
  `;
}

document.getElementById('kp-markup-input').addEventListener('input', renderKpPreview);

document.getElementById('btn-kp-download').addEventListener('click', async () => {
  if (!currentKpData) return;
  const btn = document.getElementById('btn-kp-download');
  btn.disabled = true; btn.textContent = 'Подготовка...';

  try {
    const res = await fetch(`/api/manager/projects/${activeProjectId}/kp-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentKpData)
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = currentKpData.projectName.replace(/[/\\?%*:|"<>]/g, '_');
      a.download = `КП_${safeName}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      showToast(data.error || 'Ошибка скачивания', 'error');
    }
  } catch (e) {
    console.error(e);
    showToast('Сетевая ошибка', 'error');
  }
  btn.disabled = false; btn.textContent = 'Изменить (Скачать в Word)';
});

document.getElementById('btn-kp-send').addEventListener('click', async () => {
  if (!currentKpData) return;
  const btn = document.getElementById('btn-kp-send');
  btn.disabled = true; btn.textContent = 'Отправка...';

  const fd = new FormData();
  const fileInput = document.getElementById('kp-manual-file');
  if (fileInput.files.length > 0) {
    fd.append('file', fileInput.files[0]);
  } else {
    fd.append('kpData', JSON.stringify(currentKpData));
  }

  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/kp-send`, fd);

  btn.disabled = false; btn.textContent = 'Отправить Заказчику';

  if (ok) {
    showToast('Коммерческое предложение отправлено!', 'success');
    closeModal('modal-generate-kp');
    loadProjectDocs(activeProjectId);
    loadFunnel();
    loadProjects();
  } else {
    showToast(data.error || 'Ошибка при отправке', 'error');
  }
});

// ─── AI-анализ ───────────────────────────────────────────────
document.getElementById('btn-analyze').addEventListener('click', async () => {
  const btn = document.getElementById('btn-analyze');
  const result = document.getElementById('analyze-result');
  btn.disabled = true; btn.textContent = 'Анализирую...';
  result.textContent = '';
  const { ok, data } = await apiRequest('POST', `/api/manager/projects/${activeProjectId}/analyze`);
  if (ok) result.textContent = data.data.analysis;
  else showToast(data.error, 'error');
  btn.disabled = false; btn.textContent = 'Запустить анализ';
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
  body.include_materials = e.target.querySelector('[name=include_materials]').checked;
  for (const key of Object.keys(body)) { if (body[key] === '') delete body[key]; }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', '/api/manager/projects', body);
  btn.disabled = false;

  if (ok) {
    const projectId = data.data.id;
    if (requestIdForProject) {
      await apiRequest('POST', `/api/manager/projects/${projectId}/copy-request-files`, {
        request_id: parseInt(requestIdForProject),
      });
      requestIdForProject = null;
    }
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
      <td><button class="btn btn-sm btn-outline" data-action="open-request"
          data-id="${r.id}" data-status="${r.status}"
          data-name="${escHtml(r.name || '')}" data-phone="${escHtml(r.phone || '')}"
          data-email="${escHtml(r.email || '')}" data-message="${escHtml(r.message || '')}">Открыть</button></td>
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
    ${badge(status)}
    <p class="mt-2" style="font-size:.9rem;color:var(--muted)">${escHtml(message || '—')}</p>
  `;
  document.getElementById('modal-request-files').innerHTML = '';
  loadRequestFiles(id);
  openModal('modal-request');
});

async function loadRequestFiles(id) {
  const container = document.getElementById('modal-request-files');
  const { ok, data } = await apiRequest('GET', `/api/manager/requests/${id}/files`);
  if (!ok || !data.data.length) return;
  container.innerHTML = `
    <div style="font-size:.82rem;color:var(--muted);margin-bottom:.35rem">Файлы из заявки</div>
    ${data.data.map(f => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.83rem">
        <span style="color:var(--muted);flex-shrink:0;white-space:nowrap">${escHtml(REQUEST_DOC_LABELS[f.doc_type] || f.doc_type || '—')}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.file_name)}</span>
        <a href="${f.url}" target="_blank" class="btn btn-outline btn-sm" style="font-size:.75rem;flex-shrink:0">Скачать</a>
      </div>`).join('')}
  `;
}

document.getElementById('btn-request-to-project').addEventListener('click', () => {
  requestIdForProject = activeRequestId;
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

// ─── Автодополнение Справочника ──────────────────────────────
let catalogData = [];
async function initCatalogAutocomplete(role) {
  const { ok, data } = await apiRequest('GET', `/api/${role}/catalog`);
  if (!ok) return;
  catalogData = data.data;

  const datalist = document.getElementById('catalog-datalist');
  if (datalist) {
    datalist.innerHTML = catalogData.map(c => `<option value="${escHtml(c.item_name)}"></option>`).join('');
  }

  const singleInput = document.getElementById('single-work-name-input');
  if (singleInput) {
    singleInput.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      const match = catalogData.find(c => c.item_name.toLowerCase() === val);
      if (match) {
        const form = e.target.closest('form');
        if (form && form.elements['unit']) form.elements['unit'].value = match.unit;
      }
    });
  }

  const batchBody = document.getElementById('batch-tbody');
  if (batchBody) {
    batchBody.addEventListener('input', (e) => {
      if (e.target.classList.contains('batch-name')) {
        const val = e.target.value.trim().toLowerCase();
        const match = catalogData.find(c => c.item_name.toLowerCase() === val);
        if (match) {
          const tr = e.target.closest('tr');
          if (tr) {
            const unitSel = tr.querySelector('.batch-unit');
            if (unitSel && !Array.from(unitSel.options).find(o => o.value === match.unit)) {
              unitSel.add(new Option(match.unit, match.unit));
            }
            if (unitSel) unitSel.value = match.unit;
          }
        }
      }
      if (e.target.classList.contains('batch-name') && !e.target.hasAttribute('list')) {
        e.target.setAttribute('list', 'catalog-datalist');
      }
    });
    batchBody.addEventListener('focusin', (e) => {
      if (e.target.classList.contains('batch-name') && !e.target.hasAttribute('list')) {
        e.target.setAttribute('list', 'catalog-datalist');
      }
    });
  }
}

init();
