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

const PROGRESS_LABELS = {
  green: 'Завершён',
  yellow: 'В работе',
  red: 'Не начат',
};

const PROGRESS_CLASSES = {
  green: 'is-green',
  yellow: 'is-yellow',
  red: 'is-red',
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
let projectsList = [];
let staffList = [];
let coefficientCatalog = [];
let activeProjectCoefficientIds = [];
let draftProjectCoefficientIds = [];
let managerPageMode = document.body?.dataset.managerPageMode || window.MANAGER_PAGE_MODE || 'dashboard';
let isManagerProjectPage = managerPageMode === 'project';

const REQUEST_DOC_LABELS = window.REQUEST_DOC_LABELS;

const WAREHOUSE_SOURCE_LABELS = {
  company: 'Склад компании',
  purchase: 'Закупка',
  customer: 'Давальческий',
};

const PROJECT_TEAM_ROLE_LABELS = {
  [window.APP_ROLES.FOREMAN]: 'Прораб',
  [window.APP_ROLES.PTO]: 'Инженер ПТО',
  [window.APP_ROLES.SUPPLIER]: 'Специалист МТР',
  [window.APP_ROLES.CUSTOMER]: 'Заказчик',
};

window.ManagerKp?.configure({
  getActiveProjectId: () => activeProjectId,
  onSent: async ({ projectId, sentAt }) => {
    if (activeProject && String(activeProject.id) === String(projectId)) {
      activeProject.kp_sent_at = sentAt;
    }

    const project = projectsList.find((item) => String(item.id) === String(projectId));
    if (project) project.kp_sent_at = sentAt;

    const generateBtn = document.getElementById('btn-generate-stages');
    const stagesGenerated = Boolean(activeProject?.stages_generated || project?.stages_generated);
    if (generateBtn && !stagesGenerated) {
      generateBtn.disabled = false;
      generateBtn.title = '';
    }

    window.ManagerDocuments?.load(projectId);
    loadFunnel();
    loadProjects();
  },
});
window.ManagerKp?.init();

window.ManagerEstimate?.configure({
  getActiveProjectId: () => activeProjectId,
  getActiveProject: () => activeProject,
  getProjectsList: () => projectsList,
});
window.ManagerEstimate?.init();

window.ManagerDocuments?.configure({
  getActiveProjectId: () => activeProjectId,
  getCurrentUser: () => currentUser,
});
window.ManagerDocuments?.init();

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.MANAGER);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initNotificationBell();
    initCatalogAutocomplete(window.APP_ROLES.MANAGER);
    if (isManagerProjectPage) {
      document.querySelectorAll('.sidebar-nav .nav-item[data-section]').forEach((btn) => btn.classList.remove('active'));
    }
    await window.ManagerDocuments?.loadTypes();
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
      <div class="kanban-col-title">${FUNNEL_NAMES[status]} <span class="text-muted">(${grouped[status].length})</span></div>
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
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => { card.classList.remove('is-dragging'); });
  });

  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('is-drag-over');
    });
    col.addEventListener('dragleave', () => { col.classList.remove('is-drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('is-drag-over');
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
  projectsList = data.data || [];

  const tbody = document.querySelector('#projects-table tbody');
  if (!tbody) return;
  const getProgress = (p) => {
    if (p.progress_color) return p.progress_color;
    if (p.status === 'won') return 'green';
    if ((p.stage_total || 0) > 0 && p.stage_done === p.stage_total) return 'green';
    if ((p.stage_done || 0) > 0) return 'yellow';
    return 'red';
  };

  tbody.innerHTML = projectsList.map(p => `
    <tr class="manager-project-row" data-action="open-project" data-id="${p.id}">
      <td class="manager-project-progress-cell">
        <span class="manager-project-progress-dot ${PROGRESS_CLASSES[getProgress(p)] || 'is-red'}"></span>
        <span class="manager-project-progress-label">${PROGRESS_LABELS[getProgress(p)]}</span>
      </td>
      <td class="manager-project-code">${escHtml(p.code)}</td>
      <td class="manager-project-name">${escHtml(p.name)}</td>
      <td>${badge(p.status)}</td>
      <td class="manager-project-address">${escHtml(p.address || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-muted manager-table-empty is-centered">Проектов нет</td></tr>';
}

document.getElementById('projects-table').addEventListener('click', (e) => {
  const row = e.target.closest('[data-action="open-project"]');
  if (!row) return;
  window.location.href = `/manager_project.html?id=${encodeURIComponent(row.dataset.id)}`;
});

// ─── Проект (модалка табы) ────────────────────────────────────
async function openProject(id, tab = 'main', notification = null) {
  activeProjectId = id;
  window.ManagerDocuments?.setHighlight(notification);

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
  window.ManagerDocuments?.resetForm();
  window.ManagerEstimate?.resetForProject(project);

  const kpBtn = document.getElementById('btn-open-kp');
  kpBtn.classList.remove('is-hidden');
  window.ManagerKp?.syncActionVisibility(!kpBtn.classList.contains('is-hidden'));
  kpBtn.disabled = true;
  kpBtn.title = 'Проверка состава КП...';
  window.ManagerKp?.refreshButtonState(project.id);

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
    <div class="manager-dashboard-project-grid">
      <div><span class="text-muted">Название:</span> <strong>${escHtml(project.name)}</strong></div>
      <div><span class="text-muted">Код:</span> ${escHtml(project.code)}</div>
      <div><span class="text-muted">Статус:</span> ${badge(project.status)}</div>
      <div><span class="text-muted">Дата договора:</span> ${project.contract_signed_at ? formatDate(project.contract_signed_at) : '—'}</div>
      <div><span class="text-muted">Адрес:</span> ${escHtml(project.address || '—')}</div>
      <div><span class="text-muted">Тип объекта:</span> ${escHtml(project.object_type || '—')}</div>
      <div><span class="text-muted">Класс напряжения:</span> ${escHtml(project.voltage_class || '—')}</div>
      <div><span class="text-muted">Закупка материалов (ВОМ):</span> <strong>${project.include_materials ? 'Требуется' : 'Не требуется'}</strong></div>
      <div class="wide"><span class="text-muted">Виды работ:</span> ${workTypes}</div>
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

  const visibleTeam = team.filter((member) => member.role !== window.APP_ROLES.CUSTOMER);
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
  requiredMark.classList.toggle('is-hidden', !required);
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
    panel.classList.toggle('is-hidden', panel.id !== `ptab-${tab}`);
  });
  if (isManagerProjectPage) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.delete('statusDraft');
    window.history.replaceState(null, '', url.toString());
  }
  if (tab === 'stages') loadManagerStages(activeProjectId);
  if (tab === 'estimate') window.ManagerEstimate?.open(activeProjectId);
  if (tab === 'warehouse') loadManagerWarehouse(activeProjectId);
  if (tab === 'documents') window.ManagerDocuments?.load(activeProjectId);
}

document.getElementById('modal-project').addEventListener('click', (e) => {
  const tab = e.target.closest('.project-tab');
  if (tab) switchProjectTab(tab.dataset.tab);

});

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
const TEAM_ROLES = {
  foreman: window.APP_ROLES.FOREMAN,
  pto: window.APP_ROLES.PTO,
  supplier: window.APP_ROLES.SUPPLIER,
};

async function loadStaff() {
  if (staffList.length === 0) {
    const { ok, data } = await apiRequest('GET', '/api/manager/staff');
    if (ok) staffList = data.data;
  }
  for (const [role, selId] of [
    [window.APP_ROLES.FOREMAN, 'select-foreman'],
    [window.APP_ROLES.PTO, 'select-pto'],
    [window.APP_ROLES.SUPPLIER, 'select-supplier'],
  ]) {
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
      <tr data-id="${item.id}" class="manager-coeff-row ${selected ? 'is-selected' : ''}">
        <td class="manager-coeff-num">${index + 1}</td>
        <td class="manager-coeff-main">
          <div class="manager-coeff-name">${escHtml(item.name)}</div>
          ${item.description ? `<div class="manager-coeff-description">${escHtml(item.description)}</div>` : ''}
        </td>
        <td class="manager-coeff-value">${Number(item.value).toFixed(3)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="3" class="text-muted manager-table-empty">Ничего не найдено</td></tr>';

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
  window.ManagerEstimate?.loadVOR(activeProjectId);
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

function getManagerStageDateRange(start, end) {
  if (start && end) return `${formatDate(start)} — ${formatDate(end)}`;
  if (start) return formatDate(start);
  if (end) return formatDate(end);
  return '—';
}

function getManagerStageDates(stage) {
  if (stage.is_from_vor) {
    return {
      planned: (stage.planned_start || stage.planned_end)
        ? getManagerStageDateRange(stage.planned_start, stage.planned_end)
        : (stage.planned_date ? formatDate(stage.planned_date) : '—'),
      actual: stage.actual_date
        ? formatDate(stage.actual_date)
        : (stage.actual_end ? formatDate(stage.actual_end) : '—'),
    };
  }

  return {
    planned: getManagerStageDateRange(stage.planned_start, stage.planned_end),
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
          <progress class="manager-stage-progress" value="${progress}" max="100"></progress>
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
        <progress class="manager-stage-progress" value="${overallProgress}" max="100"></progress>
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
  document.getElementById('stage-form-regular').classList.toggle('is-hidden', isVor);
  document.getElementById('stage-form-vor').classList.toggle('is-hidden', !isVor);
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
  document.getElementById('stage-form-actual-end-required').classList.toggle('is-hidden', !actualEndRequired);
  document.getElementById('stage-form-actual-date').required = actualDateRequired;
  document.getElementById('stage-form-actual-date-required').classList.toggle('is-hidden', !actualDateRequired);
  document.getElementById('stage-form-note').required = noteRequired;
  document.getElementById('stage-form-note-required').classList.toggle('is-hidden', !noteRequired);
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
    document.getElementById('stage-form-name').classList.toggle('is-readonly', isVor);
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
  if (e.target.closest('.manager-stage-menu-wrap') || e.target.closest('.manager-docs-menu-wrap')) return;
  document.querySelectorAll('.manager-stage-menu-wrap.open').forEach((item) => item.classList.remove('open'));
  document.querySelectorAll('.manager-docs-menu-wrap.open').forEach((item) => item.classList.remove('open'));
});

document.getElementById('btn-add-stage').addEventListener('click', () => {
  document.getElementById('stage-modal-title').textContent = 'Новый этап';
  document.getElementById('stage-form').reset();
  document.getElementById('stage-form-id').value = '';
  document.getElementById('stage-form-name').readOnly = false;
  document.getElementById('stage-form-name').classList.remove('is-readonly');
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

// ─── Склад (read-only) ────────────────────────────────────────
async function loadManagerWarehouse(id) {
  const container = document.getElementById('manager-warehouse-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/manager/projects/${id}/warehouse`);
  if (!ok) { container.innerHTML = '<span class="text-muted">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span class="text-muted">Склад объекта пуст</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="manager-warehouse-table">
        <thead><tr>
          <th>Материал</th>
          <th class="text-right">Поступило</th>
          <th class="text-right">Списано</th>
          <th class="text-right">Остаток</th>
          <th>Ед.</th>
          <th>Источник</th>
        </tr></thead>
        <tbody>
          ${data.data.map(item => `
            <tr>
              <td>${escHtml(item.material_name)}</td>
              <td class="text-right">${item.qty_total}</td>
              <td class="text-right">${item.qty_used}</td>
              <td class="text-right manager-warehouse-balance">${item.qty_balance}</td>
              <td class="text-muted">${escHtml(item.unit || '—')}</td>
              <td class="text-muted manager-warehouse-source">${escHtml(WAREHOUSE_SOURCE_LABELS[item.source] || item.source)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

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
      <td class="manager-request-message">${escHtml((r.message || '').slice(0, 80))}${r.message?.length > 80 ? '...' : ''}</td>
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
    <p class="manager-request-modal-message">${escHtml(message || '—')}</p>
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
    <div class="manager-request-files-title">Файлы из заявки</div>
    ${data.data.map(f => `
      <div class="manager-request-file-row">
        <span class="manager-request-file-type">${escHtml(REQUEST_DOC_LABELS[f.doc_type] || f.doc_type || '—')}</span>
        <span class="manager-request-file-name">${escHtml(f.file_name)}</span>
        <a href="${f.url}" target="_blank" class="btn btn-outline btn-sm manager-request-file-download">Скачать</a>
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
      <td class="text-muted manager-coeff-catalog-description">${escHtml(c.description || '—')}</td>
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
