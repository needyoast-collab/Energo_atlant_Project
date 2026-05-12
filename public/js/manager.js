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

let pendingDocumentHighlightId = null;

let currentUser = null;
let activeProjectId = null;
let activeProject = null;
let activeRequestId = null;
let activeRequestData = null;
let requestIdForProject = null;
let staffList = [];
let docTypes = {};
let activeWorkSpecEditId = null;
let currentKpData = null;
let coefficientCatalog = [];
let activeProjectCoefficientIds = [];
let draftProjectCoefficientIds = [];
let activeEstimateTab = 'summary';
let managerPageMode = window.MANAGER_PAGE_MODE || 'dashboard';
let isManagerProjectPage = managerPageMode === 'project';

const REQUEST_DOC_LABELS = {
  tu: 'Технические условия', rd: 'Рабочая документация',
  pd: 'Проектная документация', tz: 'Техническое задание',
  situation_plan: 'Ситуационный план', other: 'Прочее',
};

const WAREHOUSE_SOURCE_LABELS = {
  company: 'Склад компании',
  purchase: 'Закупка',
  customer: 'Давальческий',
};

const PROJECT_TEAM_ROLE_LABELS = {
  foreman: 'Прораб',
  pto: 'Инженер ПТО',
  supplier: 'Специалист МТР',
  customer: 'Заказчик',
};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth('manager');
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initNotificationBell();
    initCatalogAutocomplete('manager');
    if (isManagerProjectPage) {
      document.querySelectorAll('.sidebar-nav .nav-item[data-section]').forEach((btn) => btn.classList.remove('active'));
    }
    await loadDocTypes();
    if (isManagerProjectPage) {
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get('id');
      const projectTab = params.get('tab') || 'main';
      const draftStatus = params.get('statusDraft');
      if (projectId) {
        await openProject(projectId, projectTab);
        if (draftStatus === 'contract') prepareContractStatusEdit();
      }
    } else {
      const initialSection = window.location.hash.replace('#', '') || 'projects';
      switchDashboardSection(initialSection);
    }
  } finally {
    window.hidePreloader?.();
  }
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
if (isManagerProjectPage) {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.projectTab) {
        switchProjectTab(btn.dataset.projectTab);
        return;
      }
      const section = btn.dataset.section || 'projects';
      window.location.href = `/dashboard_manager.html#${section}`;
    });
  });
} else {
  initNav(section => {
    if (section === 'funnel') loadFunnel();
    if (section === 'projects') loadProjects();
    if (section === 'requests') loadRequests();
    if (section === 'messages') loadMessages();
    if (section === 'catalog') {
      switchTab('works');
      loadCatalog();
    }
  });
}

function switchDashboardSection(section) {
  const target = document.getElementById(`section-${section}`) ? section : 'requests';
  document.querySelectorAll('.sidebar-nav .nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === target);
  });
  document.querySelectorAll('.dash-section').forEach((item) => {
    item.classList.toggle('active', item.id === `section-${target}`);
  });

  if (target === 'funnel') loadFunnel();
  if (target === 'projects') loadProjects();
  if (target === 'requests') loadRequests();
  if (target === 'messages') loadMessages();
  if (target === 'catalog') {
    switchTab('works');
    loadCatalog();
  }
}

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
      if (newStatus === 'contract') {
        window.location.href = `/manager_project.html?id=${encodeURIComponent(dragId)}&tab=main&statusDraft=contract`;
        return;
      }
      const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${dragId}`, { status: newStatus });
      if (ok) loadFunnel();
      else showToast(data.error, 'error');
    });
  });
}

document.getElementById('kanban-board').addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  window.location.href = `/manager_project.html?id=${encodeURIComponent(card.dataset.id)}`;
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
  window.location.href = `/manager_project.html?id=${encodeURIComponent(row.dataset.id)}`;
});

// ─── Проект (модалка табы) ────────────────────────────────────
async function openProject(id, tab = 'main', notification = null) {
  activeProjectId = id;
  pendingDocumentHighlightId = notification?.entity_type === 'document' ? String(notification.entity_id || '') : null;

  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}`);
  if (!ok) return;
  const project = data.data;
  activeProject = project;

  renderProjectOverview(project);
  document.getElementById('project-status-select').value = project.status;
  const contractDateInput = document.getElementById('project-contract-signed-at');
  contractDateInput.value = project.contract_signed_at || '';
  contractDateInput.setCustomValidity('');
  updateContractDateRequirement();
  document.getElementById('project-regional-coeff-display').textContent = Number(project.regional_coeff || 1).toFixed(3);
  document.getElementById('analyze-result').textContent = '';
  document.getElementById('upload-doc-form').reset();
  document.getElementById('vor-add-form').reset();
  document.getElementById('vor-add-form').style.display = 'none';
  activeWorkSpecEditId = null;

  const generateBtn = document.getElementById('btn-generate-stages');
  const generated = !!project.stages_generated;
  const kpSent = Boolean(project.kp_sent_at);
  generateBtn.disabled = generated || !kpSent;
  generateBtn.style.display = generated ? 'none' : '';
  generateBtn.title = kpSent ? '' : 'Сначала отправьте КП заказчику';

  const kpBtn = document.getElementById('btn-open-kp');
  kpBtn.style.display = '';
  syncKpActionVisibility(kpBtn.style.display !== 'none');
  kpBtn.disabled = true;
  kpBtn.title = 'Проверка состава КП...';
  if (kpBtn.style.display !== 'none') {
    refreshKpButtonState(project.id);
  }

  switchProjectTab(tab);
  if (!isManagerProjectPage) openModal('modal-project');

  await Promise.allSettled([
    loadProjectCoefficientSummary(project.id),
    loadStaff(),
  ]);
}

function getProjectWorkTypesText(project) {
  if (!project.work_types) return '—';
  try {
    const parsed = typeof project.work_types === 'string'
      ? JSON.parse(project.work_types)
      : project.work_types;
    return Array.isArray(parsed) && parsed.length ? parsed.map(escHtml).join(', ') : '—';
  } catch {
    return escHtml(String(project.work_types));
  }
}

function getInitials(name) {
  return String(name || '—')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || '—';
}

function renderProjectOverview(project) {
  const workTypes = getProjectWorkTypesText(project);
  const projectInfo = document.getElementById('modal-project-info');
  const customerInfo = document.getElementById('manager-customer-info');
  document.getElementById('modal-project-title').textContent = project.name;
  const sidebarProjectTitle = document.getElementById('sidebar-project-title');
  if (sidebarProjectTitle) sidebarProjectTitle.textContent = project.name;
  const projectMeta = document.getElementById('manager-project-meta');
  if (projectMeta) {
    projectMeta.innerHTML = `
      <span>${escHtml(project.code || '—')}</span>
      ${badge(project.status)}
      <span>${escHtml(project.address || 'Адрес не указан')}</span>
      ${project.contract_signed_at ? `<span>Договор: ${formatDate(project.contract_signed_at)}</span>` : ''}
    `;
  }

  if (customerInfo) {
    projectInfo.innerHTML = `
      <div class="manager-main-field-grid">
        ${renderProjectField('Название', escHtml(project.name), true)}
        ${renderProjectField('Код', escHtml(project.code || '—'))}
        ${renderProjectField('Адрес', escHtml(project.address || '—'))}
        ${renderProjectField('Тип объекта', escHtml(project.object_type || '—'))}
        ${renderProjectField('Класс напряжения', escHtml(project.voltage_class || '—'))}
        ${renderProjectField('Материалы (ВОМ)', project.include_materials ? 'Требуется' : 'Не требуется', true)}
        ${renderProjectField('Виды работ', workTypes, false, true)}
        ${renderProjectField('Описание', escHtml(project.description || '—'), false, true)}
        ${renderProjectField('Примечания', escHtml(project.notes || '—'), false, true)}
      </div>
    `;
    customerInfo.innerHTML = `
      <div class="manager-main-field-grid">
        ${renderProjectField('Контакт', escHtml(project.contact_name || '—'), true)}
        ${renderProjectField('Телефон', escHtml(project.contact_phone || '—'))}
        ${renderProjectField('Email', escHtml(project.contact_email || '—'))}
        ${renderProjectField('Организация', escHtml(project.contact_org || '—'))}
      </div>
    `;
    renderProjectTeam(project.team || []);
    return;
  }

  projectInfo.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem">
      <div><span class="text-muted">Название:</span> <strong>${escHtml(project.name)}</strong></div>
      <div><span class="text-muted">Код:</span> ${escHtml(project.code)}</div>
      <div><span class="text-muted">Статус:</span> ${badge(project.status)}</div>
      <div><span class="text-muted">Дата договора:</span> ${project.contract_signed_at ? formatDate(project.contract_signed_at) : '—'}</div>
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
}

function renderProjectField(label, value, strong = false, wide = false) {
  return `
    <div class="manager-main-field ${wide ? 'wide' : ''}">
      <span>${label}</span>
      <strong class="${strong ? '' : 'regular'}">${value || '—'}</strong>
    </div>
  `;
}

function renderProjectTeam(team) {
  const container = document.getElementById('project-team-list');
  if (!container) return;

  const visibleTeam = team.filter((member) => member.role !== 'customer');
  if (!visibleTeam.length) {
    container.innerHTML = '<div class="manager-main-empty">Команда еще не назначена</div>';
    return;
  }

  container.innerHTML = visibleTeam.map((member) => `
    <div class="manager-team-member">
      <div class="manager-team-member-avatar">${getInitials(member.name)}</div>
      <div>
        <div class="manager-team-member-role">${escHtml(PROJECT_TEAM_ROLE_LABELS[member.role] || member.role)}</div>
        <div class="manager-team-member-name">${escHtml(member.name || '—')}</div>
        <div class="manager-team-member-email">${escHtml(member.email || '—')}</div>
      </div>
    </div>
  `).join('');
}

function updateContractDateRequirement() {
  const status = document.getElementById('project-status-select').value;
  const dateInput = document.getElementById('project-contract-signed-at');
  const requiredMark = document.getElementById('project-contract-required');
  const required = status === 'contract' || status === 'work' || status === 'won';
  dateInput.required = required;
  requiredMark.style.display = required ? '' : 'none';
  if (!required || dateInput.value) dateInput.setCustomValidity('');
}

function prepareContractStatusEdit() {
  const statusSelect = document.getElementById('project-status-select');
  const dateInput = document.getElementById('project-contract-signed-at');
  statusSelect.value = 'contract';
  updateContractDateRequirement();
  dateInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  dateInput.focus();
}

document.addEventListener('notification:open', async (e) => {
  const notification = e.detail;
  if (!notification?.project_id) return;
  const tab = notification.type === 'document' ? 'documents' : 'stages';
  await openProject(notification.project_id, tab, notification);
});

function switchProjectTab(tab) {
  document.querySelectorAll('.project-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.project-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.projectTab === tab);
  });
  document.querySelectorAll('.project-tab-panel').forEach(panel => {
    panel.style.display = panel.id === `ptab-${tab}` ? '' : 'none';
  });
  if (isManagerProjectPage) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.delete('statusDraft');
    window.history.replaceState(null, '', url.toString());
  }
  if (tab === 'stages') loadManagerStages(activeProjectId);
  if (tab === 'estimate') {
    loadManagerEstimate(activeProjectId);
    switchEstimateTab(activeEstimateTab);
  }
  if (tab === 'warehouse') loadManagerWarehouse(activeProjectId);
  if (tab === 'documents') loadProjectDocs(activeProjectId);
}

document.getElementById('modal-project').addEventListener('click', (e) => {
  const tab = e.target.closest('.project-tab');
  if (tab) switchProjectTab(tab.dataset.tab);

  const estimateTab = e.target.closest('[data-estimate-tab]');
  if (estimateTab) switchEstimateTab(estimateTab.dataset.estimateTab);
});

function switchEstimateTab(tab) {
  activeEstimateTab = tab;
  document.querySelectorAll('[data-estimate-tab]').forEach((btn) => {
    const isActive = btn.dataset.estimateTab === tab;
    if (btn.classList.contains('manager-estimate-tab')) {
      btn.classList.toggle('active', isActive);
    } else {
      btn.className = isActive ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    }
  });
  document.getElementById('estimate-tab-summary').style.display = tab === 'summary' ? '' : 'none';
  document.getElementById('estimate-tab-works').style.display = tab === 'works' ? '' : 'none';
  document.getElementById('estimate-tab-materials').style.display = tab === 'materials' ? '' : 'none';
}

document.getElementById('btn-save-status').addEventListener('click', async () => {
  const status = document.getElementById('project-status-select').value;
  const contractDateInput = document.getElementById('project-contract-signed-at');
  updateContractDateRequirement();
  if (contractDateInput.required && !contractDateInput.value) {
    contractDateInput.setCustomValidity('Укажите дату подписания договора.');
    contractDateInput.reportValidity();
    contractDateInput.focus();
    return;
  }

  const body = { status };
  if (contractDateInput.value) body.contract_signed_at = contractDateInput.value;
  const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${activeProjectId}`, body);
  if (ok) {
    showToast('Изменения сохранены', 'success');
    activeProject = {
      ...activeProject,
      status,
      contract_signed_at: contractDateInput.value || activeProject?.contract_signed_at || null,
    };
    renderProjectOverview(activeProject);
    updateContractDateRequirement();
    if (!isManagerProjectPage) {
      await loadFunnel();
      await loadProjects();
    }
  }
  else showToast(data.error, 'error');
});

document.getElementById('project-status-select')?.addEventListener('change', updateContractDateRequirement);
document.getElementById('project-contract-signed-at')?.addEventListener('input', updateContractDateRequirement);

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
  if (ok) {
    showToast('Участник назначен', 'success');
    const selected = staffList.find((user) => Number(user.id) === userId);
    if (selected && activeProject) {
      activeProject.team = [
        ...(activeProject.team || []).filter((member) => !(member.user_id === userId && member.role === role)),
        { user_id: selected.id, role, name: selected.name, email: selected.email },
      ];
      renderProjectTeam(activeProject.team);
    }
  }
  else showToast(data.error, 'error');
});

function calculateCoefficientTotalByIds(ids) {
  if (!ids.length) return 1;
  return ids.reduce((acc, id) => {
    const item = coefficientCatalog.find((row) => row.id === id);
    return item ? acc * Number(item.value) : acc;
  }, 1);
}

function updateProjectCoefficientSummary(items, total) {
  activeProjectCoefficientIds = items.map((item) => item.coefficient_id || item.id);
  if (activeProject) activeProject.regional_coeff = total;

  document.getElementById('project-regional-coeff-display').textContent = Number(total || 1).toFixed(3);
  document.getElementById('project-coeff-summary').textContent = items.length
    ? items.map((item) => item.name).join(', ')
    : 'Коэффициенты не выбраны';
}

async function loadProjectCoefficientSummary(projectId) {
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/coefficients`);
  if (!ok) {
    document.getElementById('project-regional-coeff-display').textContent = Number(activeProject?.regional_coeff || 1).toFixed(3);
    document.getElementById('project-coeff-summary').textContent = 'Не удалось загрузить коэффициенты проекта';
    return;
  }

  updateProjectCoefficientSummary(data.data.items, data.data.total);
}

function renderProjectCoefficientRows() {
  const tbody = document.getElementById('project-coeffs-tbody');
  const query = (document.getElementById('project-coeff-search').value || '').trim().toLowerCase();
  const rows = coefficientCatalog.filter((item) => {
    if (!query) return true;
    return item.name.toLowerCase().includes(query) || String(item.description || '').toLowerCase().includes(query);
  });

  tbody.innerHTML = rows.map((item, index) => {
    const selected = draftProjectCoefficientIds.includes(item.id);
    return `
      <tr data-id="${item.id}" style="cursor:pointer;border-bottom:1px solid var(--border);background:${selected ? 'rgba(var(--accent-rgb),.08)' : 'transparent'}">
        <td style="padding:.55rem .6rem;text-align:center;color:${selected ? 'var(--accent)' : 'var(--muted)'};font-weight:${selected ? '700' : '500'}">${index + 1}</td>
        <td style="padding:.55rem .6rem">
          <div style="font-weight:600">${escHtml(item.name)}</div>
          ${item.description ? `<div style="font-size:.76rem;color:var(--muted);margin-top:.15rem">${escHtml(item.description)}</div>` : ''}
        </td>
        <td style="padding:.55rem .6rem;text-align:right;font-weight:700">${Number(item.value).toFixed(3)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="3" class="text-muted" style="padding:.9rem .6rem">Ничего не найдено</td></tr>';

  const total = calculateCoefficientTotalByIds(draftProjectCoefficientIds);
  document.getElementById('project-coeff-selected').textContent = `Выбрано: ${draftProjectCoefficientIds.length}`;
  document.getElementById('project-coeff-total').textContent = Number(total).toFixed(3);
}

async function openProjectCoefficientsModal() {
  if (!activeProjectId) return;

  const [catalogRes, selectedRes] = await Promise.all([
    apiRequest('GET', '/api/manager/coefficients'),
    apiRequest('GET', `/api/manager/projects/${activeProjectId}/coefficients`),
  ]);

  if (!catalogRes.ok) {
    showToast(catalogRes.data?.error || 'Не удалось загрузить справочник коэффициентов', 'error');
    return;
  }

  if (!selectedRes.ok) {
    showToast(selectedRes.data?.error || 'Не удалось загрузить коэффициенты проекта', 'error');
    return;
  }

  coefficientCatalog = catalogRes.data.data.map((item) => ({
    ...item,
    id: Number(item.id),
    value: Number(item.value),
  }));
  draftProjectCoefficientIds = selectedRes.data.data.items.map((item) => Number(item.coefficient_id));

  document.getElementById('project-coeff-modal-subtitle').textContent = activeProject?.name || '';
  document.getElementById('project-coeff-search').value = '';
  renderProjectCoefficientRows();
  openModal('modal-project-coeffs');
}

document.getElementById('btn-project-coeffs').addEventListener('click', openProjectCoefficientsModal);

document.getElementById('project-coeff-search').addEventListener('input', renderProjectCoefficientRows);

document.getElementById('project-coeffs-tbody').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = Number(row.dataset.id);
  if (draftProjectCoefficientIds.includes(id)) {
    draftProjectCoefficientIds = draftProjectCoefficientIds.filter((value) => value !== id);
  } else {
    draftProjectCoefficientIds = [...draftProjectCoefficientIds, id];
  }
  renderProjectCoefficientRows();
});

document.getElementById('btn-project-coeffs-save').addEventListener('click', async () => {
  if (!activeProjectId) return;
  const btn = document.getElementById('btn-project-coeffs-save');
  btn.disabled = true;
  btn.textContent = 'Сохранение...';

  const { ok, data } = await apiRequest('PUT', `/api/manager/projects/${activeProjectId}/coefficients`, {
    coefficient_ids: draftProjectCoefficientIds,
  });

  btn.disabled = false;
  btn.textContent = 'Сохранить';

  if (!ok) {
    showToast(data.error || 'Не удалось сохранить коэффициенты проекта', 'error');
    return;
  }

  updateProjectCoefficientSummary(data.data.items, data.data.total);
  showToast('Коэффициенты проекта обновлены', 'success');
  closeModal('modal-project-coeffs');
  loadManagerVOR(activeProjectId);
});

// ─── Этапы ───────────────────────────────────────────────────
function getManagerStageStatusLabel(status) {
  return STAGE_NAMES[status] || STATUS_LABELS[status] || status || '—';
}

function getManagerStageStatusClass(status) {
  if (status === 'done') return 'is-done';
  if (status === 'in_progress') return 'is-progress';
  if (status === 'not_done') return 'is-problem';
  return 'is-planned';
}

function getManagerStageDates(stage) {
  if (stage.is_from_vor) {
    return {
      planned: stage.planned_date ? formatDate(stage.planned_date) : '—',
      actual: stage.actual_date ? formatDate(stage.actual_date) : '—',
    };
  }

  return {
    planned: `${stage.planned_start ? formatDate(stage.planned_start) : '—'} — ${stage.planned_end ? formatDate(stage.planned_end) : '—'}`,
    actual: stage.actual_end ? formatDate(stage.actual_end) : '—',
  };
}

function getManagerStageProgress(stage) {
  const planned = Number(stage.planned_value || 0);
  const actual = Number(stage.actual_value || 0);
  if (!planned || planned <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((actual / planned) * 100)));
}

function renderManagerStageItem(stage) {
  const dates = getManagerStageDates(stage);
  const progress = getManagerStageProgress(stage);
  const note = stage.note ? escHtml(stage.note) : '—';

  return `
    <article class="manager-stage-item ${stage.is_from_vor ? 'is-vor' : ''}">
      <div class="manager-stage-content">
        <div class="manager-stage-top">
          <div class="manager-stage-title-wrap">
            <div class="manager-stage-title"><span class="manager-stage-order">${stage.order_num ?? '—'}</span>${escHtml(stage.name)}</div>
          </div>
          <div class="manager-stage-status ${getManagerStageStatusClass(stage.status)}">${escHtml(getManagerStageStatusLabel(stage.status))}</div>
        </div>

        <div class="manager-stage-meta-grid">
          <div>
            <span>Плановые сроки</span>
            <strong>${dates.planned}</strong>
          </div>
          <div>
            <span>Фактическое окончание</span>
            <strong>${dates.actual}</strong>
          </div>
          <div class="wide">
            <span>Примечание</span>
            <strong>${note}</strong>
          </div>
        </div>
        <div class="manager-stage-progress-row">
          <div class="manager-stage-progress">
            <span style="width:${progress}%"></span>
          </div>
          <strong>${progress}%</strong>
        </div>
      </div>
      <div class="manager-stage-menu-wrap">
        <button class="manager-stage-menu-btn" type="button" data-stage-menu aria-label="Действия по этапу">...</button>
        <div class="manager-stage-menu">
          <button type="button"
            data-action="edit-stage" data-id="${stage.id}"
            data-name="${escHtml(stage.name)}" data-status="${stage.status}"
            data-is-from-vor="${stage.is_from_vor ? 'true' : 'false'}"
            data-order="${stage.order_num ?? ''}"
            data-start="${stage.planned_start || ''}" data-end="${stage.planned_end || ''}"
            data-actual-end="${stage.actual_end || ''}"
            data-planned-value="${stage.planned_value ?? ''}"
            data-actual-value="${stage.actual_value ?? ''}"
            data-unit="${escHtml(stage.unit || '')}"
            data-planned-date="${stage.planned_date || ''}"
            data-actual-date="${stage.actual_date || ''}"
            data-note="${escHtml(stage.note || '')}"><span>✎</span> Редактировать</button>
          <button type="button" class="danger" data-action="delete-stage" data-id="${stage.id}"><span>×</span> Удалить</button>
        </div>
      </div>
    </article>
  `;
}

async function loadManagerStages(id) {
  const container = document.getElementById('stages-list');
  container.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/stages`);
  if (!ok) { container.innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>'; return; }
  const stages = data.data || [];
  if (!stages.length) { container.innerHTML = '<div class="manager-estimate-empty">Этапов нет</div>'; return; }

  const doneCount = stages.filter((stage) => stage.status === 'done').length;
  const inProgressCount = stages.filter((stage) => stage.status === 'in_progress').length;
  const issueCount = stages.filter((stage) => stage.status === 'not_done').length;
  const overallProgress = Math.round((doneCount / stages.length) * 100);

  container.innerHTML = `
    <div class="manager-stages-summary">
      <div class="manager-stages-summary-main">
        <span>Готовность по этапам</span>
        <strong>${overallProgress}%</strong>
        <div class="manager-stage-progress"><span style="width:${overallProgress}%"></span></div>
      </div>
      <div class="manager-stages-summary-metrics">
        <div><span>Всего</span><strong>${stages.length}</strong></div>
        <div><span>Выполнено</span><strong>${doneCount}</strong></div>
        <div><span>В работе</span><strong>${inProgressCount}</strong></div>
        <div><span>Проблемы</span><strong>${issueCount}</strong></div>
      </div>
    </div>
    <div class="manager-stages-list">
      ${stages.map(renderManagerStageItem).join('')}
    </div>
  `;
}

function setManagerStageMode(isVor) {
  document.getElementById('stage-form-is-vor').value = isVor ? 'true' : 'false';
  document.getElementById('stage-form-regular').style.display = isVor ? 'none' : '';
  document.getElementById('stage-form-vor').style.display = isVor ? '' : 'none';
  document.getElementById('stage-form-planned-start').required = !isVor;
  document.getElementById('stage-form-planned-end').required = !isVor;
  updateManagerStageRequirements();
}

function updateManagerStageRequirements() {
  const isVor = document.getElementById('stage-form-is-vor').value === 'true';
  const regularStatus = document.getElementById('stage-form-status-regular').value;
  const vorStatus = document.getElementById('stage-form-status-vor').value;
  const plannedEnd = document.getElementById('stage-form-planned-end').value;
  const actualEnd = document.getElementById('stage-form-actual-end').value;
  const plannedDate = document.getElementById('stage-form-planned-date').value;
  const actualDate = document.getElementById('stage-form-actual-date').value;
  const actualEndRequired = !isVor && regularStatus === 'done';
  const actualDateRequired = isVor && vorStatus === 'done';
  const isRegularLate = !isVor && plannedEnd && actualEnd && actualEnd > plannedEnd;
  const isVorLate = isVor && plannedDate && actualDate && actualDate > plannedDate;
  const noteRequired = (isVor && vorStatus === 'not_done') || isRegularLate || isVorLate;

  document.getElementById('stage-form-actual-end').required = actualEndRequired;
  document.getElementById('stage-form-actual-end-required').style.display = actualEndRequired ? '' : 'none';
  document.getElementById('stage-form-actual-date').required = actualDateRequired;
  document.getElementById('stage-form-actual-date-required').style.display = actualDateRequired ? '' : 'none';
  document.getElementById('stage-form-note').required = noteRequired;
  document.getElementById('stage-form-note-required').style.display = noteRequired ? '' : 'none';
}

document.getElementById('stage-form-status-regular')?.addEventListener('change', updateManagerStageRequirements);
document.getElementById('stage-form-status-vor')?.addEventListener('change', updateManagerStageRequirements);
document.getElementById('stage-form-planned-end')?.addEventListener('change', updateManagerStageRequirements);
document.getElementById('stage-form-actual-end')?.addEventListener('change', updateManagerStageRequirements);
document.getElementById('stage-form-planned-date')?.addEventListener('change', updateManagerStageRequirements);
document.getElementById('stage-form-actual-date')?.addEventListener('change', updateManagerStageRequirements);

document.getElementById('stages-list').addEventListener('click', async (e) => {
  const menuBtn = e.target.closest('[data-stage-menu]');
  if (menuBtn) {
    const wrap = menuBtn.closest('.manager-stage-menu-wrap');
    document.querySelectorAll('.manager-stage-menu-wrap.open').forEach((item) => {
      if (item !== wrap) item.classList.remove('open');
    });
    wrap?.classList.toggle('open');
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  btn.closest('.manager-stage-menu-wrap')?.classList.remove('open');

  if (btn.dataset.action === 'edit-stage') {
    document.getElementById('stage-modal-title').textContent = 'Редактировать этап';
    const isVor = btn.dataset.isFromVor === 'true';
    document.getElementById('stage-form-id').value = btn.dataset.id;
    document.getElementById('stage-form-name').value = btn.dataset.name;
    document.getElementById('stage-form-name').readOnly = isVor;
    document.getElementById('stage-form-name').style.background = isVor ? 'var(--bg3)' : '';
    document.getElementById('stage-form-name').style.color = isVor ? 'var(--muted)' : '';
    document.getElementById('stage-form-order').value = btn.dataset.order || '';
    document.getElementById('stage-form-planned-start').value = btn.dataset.start || '';
    document.getElementById('stage-form-planned-end').value = btn.dataset.end || '';
    document.getElementById('stage-form-actual-end').value = btn.dataset.actualEnd || '';
    document.getElementById('stage-form-planned-value').value = btn.dataset.plannedValue || '';
    document.getElementById('stage-form-actual-value').value = btn.dataset.actualValue || '';
    document.getElementById('stage-form-unit').value = btn.dataset.unit || '';
    document.getElementById('stage-form-planned-date').value = btn.dataset.plannedDate || '';
    document.getElementById('stage-form-actual-date').value = btn.dataset.actualDate || '';
    document.getElementById('stage-form-note').value = btn.dataset.note || '';
    document.getElementById(isVor ? 'stage-form-status-vor' : 'stage-form-status-regular').value = btn.dataset.status || (isVor ? 'planned' : 'pending');
    setManagerStageMode(isVor);
    openModal('modal-manager-stage');
  }

  if (btn.dataset.action === 'delete-stage') {
    if (!confirm('Удалить этап?')) return;
    const { ok, data } = await apiRequest('DELETE', `/api/manager/stages/${btn.dataset.id}`);
    if (ok) { showToast('Этап удалён', 'success'); loadManagerStages(activeProjectId); }
    else showToast(data.error, 'error');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('.manager-stage-menu-wrap')) return;
  document.querySelectorAll('.manager-stage-menu-wrap.open').forEach((item) => item.classList.remove('open'));
});

document.getElementById('btn-add-stage').addEventListener('click', () => {
  document.getElementById('stage-modal-title').textContent = 'Новый этап';
  document.getElementById('stage-form').reset();
  document.getElementById('stage-form-id').value = '';
  document.getElementById('stage-form-name').readOnly = false;
  document.getElementById('stage-form-name').style.background = '';
  document.getElementById('stage-form-name').style.color = '';
  document.getElementById('stage-form-status-regular').value = 'pending';
  document.getElementById('stage-form-status-vor').value = 'planned';
  setManagerStageMode(false);
  openModal('modal-manager-stage');
});

document.getElementById('stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const stageId = document.getElementById('stage-form-id').value;
  const isVor = document.getElementById('stage-form-is-vor').value === 'true';
  const name = document.getElementById('stage-form-name').value.trim();
  const orderValue = document.getElementById('stage-form-order').value;
  const note = document.getElementById('stage-form-note').value.trim();
  let body;

  if (isVor) {
    const status = document.getElementById('stage-form-status-vor').value;
    if (status === 'not_done' && !note) {
      showToast('Укажите причину невыполнения этапа', 'error');
      return;
    }
    if (status === 'done' && !document.getElementById('stage-form-actual-date').value) {
      showToast('Для выполненной работы укажите фактическое окончание', 'error');
      return;
    }
    const plannedDate = document.getElementById('stage-form-planned-date').value;
    const actualDate = document.getElementById('stage-form-actual-date').value;
    if (plannedDate && actualDate && actualDate > plannedDate && !note) {
      showToast('При просрочке укажите пояснение в примечании', 'error');
      return;
    }
    body = {
      name,
      status,
      order_num: orderValue ? parseInt(orderValue, 10) : undefined,
      actual_value: document.getElementById('stage-form-actual-value').value ? parseFloat(document.getElementById('stage-form-actual-value').value) : undefined,
      planned_date: document.getElementById('stage-form-planned-date').value || undefined,
      actual_date: document.getElementById('stage-form-actual-date').value || undefined,
      note,
    };
  } else {
    const status = document.getElementById('stage-form-status-regular').value;
    const plannedStart = document.getElementById('stage-form-planned-start').value;
    const plannedEnd = document.getElementById('stage-form-planned-end').value;
    const actualEnd = document.getElementById('stage-form-actual-end').value;
    if (!plannedStart || !plannedEnd) {
      showToast('Заполните плановое начало и окончание этапа', 'error');
      return;
    }
    if (status === 'done' && !actualEnd) {
      showToast('Для завершённого этапа укажите фактическое окончание', 'error');
      return;
    }
    if (plannedEnd && actualEnd && actualEnd > plannedEnd && !note) {
      showToast('При просрочке укажите пояснение в примечании', 'error');
      return;
    }
    body = {
      name,
      order_num: orderValue ? parseInt(orderValue, 10) : undefined,
      planned_start: plannedStart,
      planned_end: plannedEnd,
      note,
    };
    if (stageId) {
      body.status = status;
      body.actual_end = actualEnd || undefined;
    }
  }

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
function getVorPriceMeta(ws) {
  const hasManagerPrice = ws.manager_price !== null && ws.manager_price !== undefined && ws.manager_price !== '';
  const managerPrice = hasManagerPrice ? Number(ws.manager_price) : null;
  const catalogPrice = ws.catalog_price !== null && ws.catalog_price !== undefined && ws.catalog_price !== ''
    ? Number(ws.catalog_price)
    : null;

  if (managerPrice !== null && !Number.isNaN(managerPrice)) {
    return {
      price: managerPrice,
      source: 'manager',
      hint: catalogPrice !== null ? 'Ручная цена менеджера' : 'Цена задана менеджером',
    };
  }

  if (catalogPrice !== null && !Number.isNaN(catalogPrice) && catalogPrice > 0) {
    return {
      price: catalogPrice,
      source: 'catalog',
      hint: 'Цена из справочника работ',
    };
  }

  return {
    price: 0,
    source: 'empty',
    hint: 'Цена не задана',
  };
}

function setVorPriceHint({ catalogPrice = null, isOverride = false } = {}) {
  const hint = document.getElementById('vor-price-hint');
  if (!hint) return;

  if (catalogPrice && !isOverride) {
    hint.textContent = `Если поле пустое, используется цена из утверждённого справочника работ: ${formatMoney(catalogPrice)}.`;
    return;
  }

  if (catalogPrice && isOverride) {
    hint.textContent = `Сейчас задана ручная цена менеджера. Очистите поле и сохраните, чтобы вернуться к цене из справочника: ${formatMoney(catalogPrice)}.`;
    return;
  }

  hint.textContent = 'Если поле пустое, используется цена из утверждённого справочника работ.';
}

function renderVorRow(ws) {
  const priceMeta = getVorPriceMeta(ws);
  const price = priceMeta.price;
  const rCoeff = Number(activeProject.regional_coeff || 1.0);
  const sum = price * Number(ws.quantity) * rCoeff;
  const sumStr = sum ? sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽' : '—';
  const priceLabel = price
    ? `${price.toLocaleString('ru-RU')} ₽`
    : '<span class="manager-estimate-warning">Не задана</span>';
  const priceHint = priceMeta.source === 'empty'
    ? ''
    : `<div class="manager-estimate-cell-hint">${priceMeta.hint}</div>`;

  return `
    <tr>
      <td>${escHtml(ws.work_name)}</td>
      <td class="num">${ws.quantity}</td>
      <td class="muted">${escHtml(ws.unit || '—')}</td>
      <td class="num strong">
        ${priceLabel}
        ${priceHint}
      </td>
      <td class="num strong">${sumStr}</td>
      <td class="actions">
        <div class="manager-estimate-row-actions">
          <button class="manager-stage-action manager-stage-action-edit"
          data-action="edit-vor"
          data-id="${ws.id}"
          data-work-name="${escHtml(ws.work_name)}"
          data-unit="${escHtml(ws.unit || '')}"
          data-quantity="${ws.quantity}"
          data-price="${ws.manager_price ?? ''}"
          data-catalog-price="${ws.catalog_price ?? ''}">Ред.</button>
          <button class="manager-stage-action manager-stage-action-delete"
            data-action="delete-vor" data-id="${ws.id}" aria-label="Удалить позицию">×</button>
        </div>
      </td>
    </tr>
  `;
}

async function loadManagerVOR(id) {
  const container = document.getElementById('vor-list');
  container.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/work-specs`);
  if (!ok) { container.innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>'; return; }
  if (!data.data.length) {
    container.innerHTML = '<div class="manager-estimate-empty">ВОР пустой</div>';
    refreshKpButtonState(id);
    return;
  }

  container.innerHTML = `
    <div class="manager-estimate-table-wrap">
      <table class="manager-estimate-table">
        <thead><tr>
          <th>Вид работ</th>
          <th class="num">Количество</th>
          <th>Ед.</th>
          <th class="num">Цена за ед.</th>
          <th class="num">Сумма</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${data.data.map(renderVorRow).join('')}
        </tbody>
      </table>
    </div>
  `;
  refreshKpButtonState(id);
}

document.getElementById('vor-list').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-action="edit-vor"]');
  if (editBtn) {
    const form = document.getElementById('vor-add-form');
    const priceInput = form.querySelector('[name="manager_price"]');
    const catalogPrice = editBtn.dataset.catalogPrice ? Number(editBtn.dataset.catalogPrice) : null;
    form.style.display = '';
    form.querySelector('[name="work_name"]').value = editBtn.dataset.workName || '';
    form.querySelector('[name="quantity"]').value = editBtn.dataset.quantity || '';
    form.querySelector('[name="unit"]').value = editBtn.dataset.unit || '';
    priceInput.value = editBtn.dataset.price || '';
    priceInput.placeholder = catalogPrice ? formatMoney(catalogPrice) : 'Из справочника';
    setVorPriceHint({ catalogPrice, isOverride: Boolean(editBtn.dataset.price) });
    activeWorkSpecEditId = editBtn.dataset.id;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Сохранить';
    return;
  }

  const btn = e.target.closest('[data-action="delete-vor"]');
  if (!btn) return;
  if (!confirm('Удалить позицию ВОР?')) return;
  const { ok, data } = await apiRequest('DELETE', `/api/manager/work-specs/${btn.dataset.id}`);
  if (ok) { showToast('Позиция удалена', 'success'); loadManagerVOR(activeProjectId); }
  else showToast(data.error, 'error');
});

document.getElementById('btn-add-vor').addEventListener('click', () => {
  const form = document.getElementById('vor-add-form');
  activeWorkSpecEditId = null;
  form.reset();
  form.querySelector('[name="manager_price"]').placeholder = 'Из справочника';
  setVorPriceHint();
  form.querySelector('button[type="submit"]').textContent = 'Добавить';
  form.style.display = form.style.display === 'none' ? '' : 'none';
});

document.getElementById('btn-cancel-vor').addEventListener('click', () => {
  activeWorkSpecEditId = null;
  const form = document.getElementById('vor-add-form');
  form.reset();
  form.querySelector('[name="manager_price"]').placeholder = 'Из справочника';
  setVorPriceHint();
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
  if (fd.get('manager_price')) {
    body.manager_price = parseFloat(fd.get('manager_price'));
  } else if (activeWorkSpecEditId) {
    body.manager_price = null;
  }

  const isEdit = !!activeWorkSpecEditId;
  const { ok, data } = isEdit
    ? await apiRequest('PUT', `/api/manager/work-specs/${activeWorkSpecEditId}`, body)
    : await apiRequest('POST', `/api/manager/projects/${activeProjectId}/work-specs`, body);
  if (ok) {
    showToast(isEdit ? 'Позиция обновлена' : 'Позиция добавлена', 'success');
    e.target.reset();
    e.target.querySelector('[name="manager_price"]').placeholder = 'Из справочника';
    setVorPriceHint();
    document.getElementById('vor-add-form').style.display = 'none';
    e.target.querySelector('button[type="submit"]').textContent = 'Добавить';
    activeWorkSpecEditId = null;
    loadManagerVOR(activeProjectId);
  } else showToast(data.error, 'error');
});

document.getElementById('btn-generate-stages').addEventListener('click', async () => {
  const project = projectsList.find(p => p.id == activeProjectId);
  if (!project?.kp_sent_at) {
    showToast('Сначала отправьте КП заказчику', 'error');
    return;
  }
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
  container.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/specs`);
  if (!ok) { container.innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>'; return; }
  if (!data.data.length) {
    container.innerHTML = '<div class="manager-estimate-empty">Ведомость материалов пуста</div>';
    refreshKpButtonState(id);
    return;
  }

  container.innerHTML = `
    <div class="manager-estimate-table-wrap">
      <table class="manager-estimate-table">
        <thead><tr>
          <th>Материал</th>
          <th class="num">Кол-во</th>
          <th>Ед.</th>
          <th class="num">Цена</th>
          <th class="num">Сумма</th>
          <th>Статус</th>
          <th>Снабженец</th>
        </tr></thead>
        <tbody>
          ${data.data.map(s => `
            <tr>
              <td>${escHtml(s.material_name)}</td>
              <td class="num">${s.quantity}</td>
              <td class="muted">${escHtml(s.unit || '—')}</td>
              <td class="num">${formatMoney(Number(s.unit_price || 0))}</td>
              <td class="num strong">${formatMoney(Number(s.quantity) * Number(s.unit_price || 0))}</td>
              <td>${badge(s.status)}</td>
              <td class="muted small">${escHtml(s.supplier_name || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  refreshKpButtonState(id);
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
              <td style="color:var(--muted);font-size:.8rem">${escHtml(WAREHOUSE_SOURCE_LABELS[item.source] || item.source)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadEstimateSummary(id) {
  const container = document.getElementById('estimate-summary');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';

  const [worksRes, materialsRes] = await Promise.all([
    apiRequest('GET', `/api/manager/projects/${id}/work-specs`),
    apiRequest('GET', `/api/manager/projects/${id}/specs`),
  ]);

  if (!worksRes.ok || !materialsRes.ok) {
    container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>';
    return;
  }

  const works = worksRes.data.data || [];
  const materials = materialsRes.data.data || [];
  const worksBaseTotal = works.reduce((acc, item) => {
    const price = Number(item.manager_price ?? item.catalog_price ?? 0);
    return acc + (Number(item.quantity) * price);
  }, 0);
  const materialsTotal = materials.reduce((acc, item) => (
    acc + (Number(item.quantity) * Number(item.unit_price || 0))
  ), 0);
  const regionalCoeff = Number(activeProject?.regional_coeff || 1);
  const worksTotal = parseFloat((worksBaseTotal * regionalCoeff).toFixed(2));
  const totalPositions = works.length + materials.length;
  const grandTotal = parseFloat((worksTotal + materialsTotal).toFixed(2));

  container.innerHTML = `
    <div class="manager-estimate-summary-grid">
      <div class="manager-estimate-summary-card manager-estimate-summary-card-main">
        <div class="manager-estimate-summary-top">
          <div>
            <div class="manager-estimate-summary-label">Итог по проекту</div>
            <div class="manager-estimate-summary-total">${formatMoney(grandTotal)}</div>
          </div>
          <div class="manager-estimate-summary-coeff">
            <div class="manager-estimate-summary-label">Коэффициент проекта</div>
            <strong>${regionalCoeff.toFixed(3)}</strong>
          </div>
        </div>
        <div class="manager-estimate-metrics">
          <div>
            <span>Работы</span>
            <strong>${formatMoney(worksTotal)}</strong>
            <small>Позиций: ${works.length}${regionalCoeff !== 1 ? ` · с кэф. ${regionalCoeff.toFixed(3)}` : ''}</small>
          </div>
          <div>
            <span>Материалы</span>
            <strong>${formatMoney(materialsTotal)}</strong>
            <small>Позиций: ${materials.length}</small>
          </div>
          <div>
            <span>Состав</span>
            <strong>${totalPositions}</strong>
            <small>Всего позиций</small>
          </div>
        </div>
      </div>
      <div class="manager-estimate-summary-card">
        <div class="manager-estimate-summary-label">Структура сметы</div>
        <div class="manager-estimate-breakdown">
          <div>
            <span>Работы</span>
            <strong>${formatMoney(worksTotal)}</strong>
          </div>
          <div>
            <span>Материалы</span>
            <strong>${formatMoney(materialsTotal)}</strong>
          </div>
          <div class="manager-estimate-breakdown-total">
            <span>Итог сметы</span>
            <strong>${formatMoney(grandTotal)}</strong>
          </div>
        </div>
        <div class="manager-estimate-summary-note">
          Материалы считаются по цене, указанной снабженцем в ведомости материалов. Этот же расчет используется при формировании КП.
        </div>
      </div>
    </div>
  `;
}

async function loadManagerEstimate(id) {
  await Promise.all([
    loadManagerVOR(id),
    loadManagerSpecs(id),
    loadEstimateSummary(id),
  ]);
  await refreshKpButtonState(id);
}

// ─── Документы ───────────────────────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--muted)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Документов нет</span>'; return; }

  container.innerHTML = data.data.map(doc => `
    <div data-doc-id="${doc.id}" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem;border:1px solid transparent;border-bottom-color:var(--border);border-radius:8px">
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

  if (pendingDocumentHighlightId) {
    const target = container.querySelector(`[data-doc-id="${pendingDocumentHighlightId}"]`);
    if (target) {
      target.classList.add('entity-highlight');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    pendingDocumentHighlightId = null;
  }
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
function getKpAvailability(payload) {
  const hasWorks = payload.works.length > 0;
  const requiresMaterials = !!payload.project.include_materials;
  const hasMaterials = payload.materials.length > 0;

  if (!hasWorks) {
    return { disabled: true, reason: 'Для формирования КП нужно добавить хотя бы одну позицию ВОР' };
  }

  if (requiresMaterials && !hasMaterials) {
    return { disabled: true, reason: 'Для формирования КП нужно заполнить ВОМ или отметить, что материалы не требуются' };
  }

  return { disabled: false, reason: '' };
}

function syncKpActionVisibility(isVisible) {
  const action = document.getElementById('estimate-kp-action');
  if (action) action.style.display = isVisible ? '' : 'none';
}

async function refreshKpButtonState(projectId) {
  if (!projectId) return;

  const kpBtn = document.getElementById('btn-open-kp');
  if (!kpBtn) return;
  if (kpBtn.style.display === 'none') {
    syncKpActionVisibility(false);
    return;
  }

  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/kp-data`);
  if (!ok) {
    kpBtn.disabled = true;
    kpBtn.title = data.error || 'Не удалось проверить данные для КП';
    syncKpActionVisibility(true);
    return;
  }

  const availability = getKpAvailability(data.data);
  kpBtn.disabled = availability.disabled;
  kpBtn.title = availability.reason || '';
  syncKpActionVisibility(true);
}

document.getElementById('btn-open-kp').addEventListener('click', async () => {
  const kpBtn = document.getElementById('btn-open-kp');
  if (kpBtn.disabled) return;

  const container = document.getElementById('kp-preview-content');
  container.innerHTML = '<span style="color:var(--muted)">Сбор данных для КП...</span>';
  document.getElementById('kp-markup-input').value = '0';
  document.getElementById('kp-final-sum-label').textContent = '0';
  document.getElementById('kp-manual-file').value = '';

  openModal('modal-generate-kp');

  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${activeProjectId}/kp-data`);
  if (!ok) {
    container.innerHTML = `<span style="color:red">Ошибка: ${data.error}</span>`;
    return;
  }

  const payload = data.data;
  const availability = getKpAvailability(payload);
  if (availability.disabled) {
    container.innerHTML = `<strong>${escHtml(availability.reason)}</strong>`;
    kpBtn.disabled = true;
    kpBtn.title = availability.reason;
    return;
  }

  const regionalCoeff = Number(payload.project.regional_coeff || 1);

  let worksTotal = 0;
  payload.works.forEach((w) => {
    w.effective_price = Number(w.effective_price || 0);
    w.total = parseFloat((w.quantity * w.effective_price * regionalCoeff).toFixed(2));
    worksTotal += w.total;
  });

  let materialsTotal = 0;
  if (payload.project.include_materials) {
    payload.materials.forEach((m) => {
      m.unit_price = Number(m.unit_price || 0);
      m.total = parseFloat((m.quantity * m.unit_price).toFixed(2));
      materialsTotal += m.total;
    });
  }

  const baseSum = parseFloat((worksTotal + materialsTotal).toFixed(2));

  currentKpData = {
    date: new Date().toLocaleDateString('ru-RU'),
    customerName: payload.project.contact_name || 'Не указан',
    projectName: payload.project.name,
    projectAddress: payload.project.address || 'Не указан',
    projectCode: payload.project.code,
    include_materials: payload.project.include_materials,
    regionalCoeff,
    works: payload.works,
    materials: payload.materials,
    worksTotal,
    materialsTotal,
    baseSum,
    baseSumWords: numberToWordsRu(baseSum),
    finalSum: baseSum,
    finalSumWords: numberToWordsRu(baseSum),
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
        Исх. № <strong>будет присвоен при отправке</strong><br>
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
        Детальная ведомость объемов работ ${currentKpData.include_materials ? 'и материалов ' : ''}с разбивкой по позициям приведена ниже.
      </p>

      <div style="margin-bottom:1.5rem;">
        <div style="font-weight:700; margin-bottom:.75rem;">Ведомость работ</div>
        <table style="width:100%; border-collapse:collapse; font-size:.92rem;">
          <thead>
            <tr>
              <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Работа</th>
              <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Кол-во</th>
              <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Ед.</th>
              <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Цена</th>
              <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${currentKpData.works.map((w) => `
              <tr>
                <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem;">${escHtml(w.work_name)}</td>
                <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right;">${w.quantity}</td>
                <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem;">${escHtml(w.unit || '—')}</td>
                <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right;">${w.effective_price ? formatMoney(w.effective_price) : '0 ₽'}</td>
                <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right; font-weight:600;">${formatMoney(w.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${currentKpData.include_materials ? `
        <div style="margin-bottom:1.5rem;">
          <div style="font-weight:700; margin-bottom:.75rem;">Ведомость материалов</div>
          <table style="width:100%; border-collapse:collapse; font-size:.92rem;">
            <thead>
              <tr>
                <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Материал</th>
                <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Кол-во</th>
                <th style="text-align:left; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Ед.</th>
                <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Цена</th>
                <th style="text-align:right; border-bottom:1px solid #d1d5db; padding:.45rem .35rem;">Сумма</th>
              </tr>
            </thead>
            <tbody>
              ${currentKpData.materials.map((m) => `
                <tr>
                  <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem;">${escHtml(m.material_name)}</td>
                  <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right;">${m.quantity}</td>
                  <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem;">${escHtml(m.unit || '—')}</td>
                  <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right;">${m.unit_price ? formatMoney(m.unit_price) : '0 ₽'}</td>
                  <td style="border-bottom:1px solid #e5e7eb; padding:.45rem .35rem; text-align:right; font-weight:600;">${formatMoney(m.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="margin-bottom:1.5rem; padding:.9rem 1rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; font-size:.92rem;">
          Материалы не включены в КП для этого проекта.
        </div>
      `}

      <div style="display:grid; gap:.35rem; margin-bottom:1rem; font-size:.95rem;">
        <div>Работы: <strong>${formatMoney(currentKpData.worksTotal)}</strong></div>
        ${currentKpData.include_materials ? `<div>Материалы: <strong>${formatMoney(currentKpData.materialsTotal)}</strong></div>` : ''}
        ${currentKpData.regionalCoeff !== 1 ? `<div>Региональный коэффициент для работ: <strong>${currentKpData.regionalCoeff}</strong></div>` : ''}
        ${markup ? `<div>Ручная корректировка: <strong>${formatMoney(markup)}</strong></div>` : ''}
      </div>

      <div style="font-size: 0.85rem; color: var(--muted); border-top: 1px dashed #ccc; padding-top: 1rem;">
        <em>* Предпросмотр перед отправкой. Итоговый документ будет сформирован из Word-шаблона и сохранён в документах проекта.</em>
      </div>
    </div>
  `;
}

document.getElementById('kp-markup-input')?.addEventListener('input', renderKpPreview);

document.getElementById('btn-kp-download')?.addEventListener('click', async () => {
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
  btn.disabled = false; btn.textContent = 'Скачать Word (.docx)';
});

document.getElementById('btn-kp-send')?.addEventListener('click', async () => {
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
    showToast(data.message || 'Коммерческое предложение отправлено!', 'success');
    closeModal('modal-generate-kp');
    const project = projectsList.find(p => p.id == activeProjectId);
    if (project) project.kp_sent_at = new Date().toISOString().slice(0, 10);
    const generateBtn = document.getElementById('btn-generate-stages');
    if (generateBtn && !project?.stages_generated) {
      generateBtn.disabled = false;
      generateBtn.title = '';
    }
    loadProjectDocs(activeProjectId);
    loadFunnel();
    loadProjects();
  } else {
    showToast(data.error || 'Ошибка при отправке', 'error');
  }
});

// ─── AI-анализ ───────────────────────────────────────────────
document.getElementById('btn-analyze')?.addEventListener('click', async () => {
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
document.getElementById('btn-create-project')?.addEventListener('click', () => {
  document.getElementById('create-project-form').reset();
  openModal('modal-create-project');
});

const createProjectForm = document.getElementById('create-project-form');
const createProjectAddressInput = createProjectForm?.querySelector('[name=address]');

createProjectAddressInput?.addEventListener('input', () => {
  createProjectAddressInput.setCustomValidity('');
});

createProjectForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const addressInput = e.target.querySelector('[name=address]');
  const addressValue = String(addressInput?.value || '').trim();
  if (!addressValue) {
    addressInput?.setCustomValidity('Заполните это поле.');
    addressInput?.reportValidity();
    addressInput?.focus();
    return;
  }
  addressInput?.setCustomValidity('');

  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());

  delete body.work_types;
  const workTypes = Array.from(e.target.querySelectorAll('[name=work_types]:checked')).map(cb => cb.value);
  if (workTypes.length) body.work_types = workTypes;
  if (body.contract_value) body.contract_value = parseFloat(body.contract_value);
  else delete body.contract_value;
  body.include_materials = e.target.querySelector('[name=include_materials]')?.checked || false;
  if (requestIdForProject) body.request_id = parseInt(requestIdForProject, 10);
  for (const key of Object.keys(body)) { if (body[key] === '') delete body[key]; }
  body.address = addressValue;

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

document.getElementById('requests-table')?.addEventListener('click', (e) => {
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

document.getElementById('btn-request-to-project')?.addEventListener('click', () => {
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

document.getElementById('btn-new-message')?.addEventListener('click', () => {
  document.getElementById('new-message-form').reset();
  openModal('modal-new-message');
});

document.getElementById('new-message-form')?.addEventListener('submit', async (e) => {
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

// ─── Автодополнение Справочника работ ────────────────────────
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

// ─── Справочник работ (Только чтение) ───────────────────────
async function loadCatalog() {
  const tbody = document.querySelector('#catalog-table tbody');
  if (!tbody) return;
  const q = document.getElementById('catalog-search')?.value || '';
  tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Загрузка...</td></tr>';
  
  const { ok, data } = await apiRequest('GET', `/api/manager/catalog?q=${encodeURIComponent(q)}`);
  if (!ok) return;

  tbody.innerHTML = data.data.map(c => `
    <tr>
      <td>${escHtml(c.item_name)}</td>
      <td>${escHtml(c.unit)}</td>
      <td>${Number(c.base_price).toLocaleString('ru-RU')} ₽</td>
      <td>${c.is_approved ? '<span class="badge badge-green">Утверждено</span>' : '<span class="badge badge-yellow">Модерация</span>'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="text-muted">Справочник работ пуст</td></tr>';
}

async function loadCoefficients() {
  const tbody = document.querySelector('#coeffs-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', '/api/manager/coefficients');
  if (!ok) return;

  tbody.innerHTML = data.data.map(c => `
    <tr>
      <td>${escHtml(c.name)}</td>
      <td>${Number(c.value).toFixed(3)}</td>
      <td class="text-muted" style="font-size:.82rem">${escHtml(c.description || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="text-muted">Коэффициенты не заданы</td></tr>';
}

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
  if (btn.closest('#section-catalog')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
});

let catalogSearchTimeout;
document.getElementById('catalog-search')?.addEventListener('input', (e) => {
  clearTimeout(catalogSearchTimeout);
  catalogSearchTimeout = setTimeout(() => loadCatalog(), 500);
});

init();
