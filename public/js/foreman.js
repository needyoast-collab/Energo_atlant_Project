const SOURCE_LABELS = { company: 'Общий склад', purchase: 'Закупка', customer: 'От заказчика' };
const VOR_STATUS_LABELS = {
  pending: 'Запланировано',
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Выполнено',
  not_done: 'Не выполнено',
};

let currentUser       = null;
let projectsList      = [];
let activeProjectId   = null;
let activeStageId     = null;
let activeStageIsVor  = false;
let activeStageUsesVolume = false;
let currentStagesList = [];
let activeProjectTab = null;
let loadedProjectTabs = new Set();
let projectTabLoadPromises = new Map();

function getInitialForemanPageMode() {
  return document.body?.dataset.foremanPageMode || window.FOREMAN_PAGE_MODE || 'dashboard';
}

let foremanPageMode = getInitialForemanPageMode();
let isForemanProjectPage = foremanPageMode === 'project';

window.ForemanSpecs?.configure({
  getActiveProjectId: () => activeProjectId,
});
window.ForemanSpecs?.init();

window.ForemanWarehouse?.configure({
  getActiveProjectId: () => activeProjectId,
  isProjectPage: () => isForemanProjectPage,
});
window.ForemanWarehouse?.init();

function resetProjectTabCache() {
  activeProjectTab = null;
  loadedProjectTabs = new Set();
  projectTabLoadPromises = new Map();
}

function loadProjectTabData(tab, { force = false } = {}) {
  if (!activeProjectId || (!force && loadedProjectTabs.has(tab))) return Promise.resolve();
  if (!force && projectTabLoadPromises.has(tab)) return projectTabLoadPromises.get(tab);

  const loaders = {
    stages: () => loadStages(activeProjectId),
    calendar: () => window.ForemanCalendar?.load(activeProjectId),
    specs: () => window.ForemanSpecs?.load(activeProjectId),
    'work-specs': () => loadWorkSpecs(activeProjectId),
    warehouse: () => window.ForemanWarehouse?.loadProject(activeProjectId),
    docs: () => loadProjectDocs(activeProjectId),
  };
  const loader = loaders[tab];
  if (!loader) return Promise.resolve();

  const promise = Promise.resolve(loader())
    .then(() => loadedProjectTabs.add(tab))
    .catch((err) => {
      loadedProjectTabs.delete(tab);
      throw err;
    })
    .finally(() => projectTabLoadPromises.delete(tab));
  projectTabLoadPromises.set(tab, promise);
  return promise;
}

function invalidateProjectTabs(...tabs) {
  tabs.forEach((tab) => loadedProjectTabs.delete(tab));
}

function reloadProjectTab(tab) {
  invalidateProjectTabs(tab);
  if (activeProjectTab === tab) return loadProjectTabData(tab, { force: true });
  return Promise.resolve();
}

function preloadProjectTabs(priorityTab) {
  const tabs = [
    priorityTab,
    ...TABS.filter((tab) => tab !== priorityTab),
  ];
  return Promise.allSettled(tabs.map((tab) => loadProjectTabData(tab)));
}

window.ForemanProjectTabs = {
  invalidate: invalidateProjectTabs,
  reload: reloadProjectTab,
};

window.ForemanStageDetails?.configure({
  getActiveStageId: () => activeStageId,
  getActiveProjectId: () => activeProjectId,
  reloadStages: () => reloadProjectTab('stages'),
});
window.ForemanStageDetails?.init();

window.ForemanCalendar?.configure({
  getActiveProjectId: () => activeProjectId,
  statusLabels: VOR_STATUS_LABELS,
});
window.ForemanCalendar?.init();

// ─── Инициализация ────────────────────────────────────────────
async function init(mode = getInitialForemanPageMode()) {
  try {
    foremanPageMode = mode;
    isForemanProjectPage = foremanPageMode === 'project';
    currentUser = await requireAuth(window.APP_ROLES.FOREMAN);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initCatalogAutocomplete(window.APP_ROLES.FOREMAN);
    const context = getForemanContext();
    window.initForemanModeNavigation?.(context);
    await loadProjects();
    await window.initForemanAfterProjects?.(context);
  } finally {
    window.hidePreloader?.();
  }
}

function getForemanContext() {
  return {
    ensureProjects: async () => {
      if (!projectsList.length) await loadProjects();
      return projectsList;
    },
    reloadProjects: loadProjects,
    openProject,
    sourceLabels: SOURCE_LABELS,
    startWarehouseWriteoff: window.ForemanWarehouse?.startWriteoff,
  };
}

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/foreman/projects');
  if (!ok) return;
  projectsList = data.data;

  const container = document.getElementById('projects-list');
  if (!container) return;
  if (!projectsList.length) {
    container.innerHTML = `<div class="card empty-card">
      Нет проектов. Войдите по коду от менеджера.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="card p-0 overflow-hidden">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Проект</th>
              <th>Адрес</th>
              <th>Менеджер</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${projectsList.map(p => `
              <tr class="supplier-project-card" data-action="open-project" data-id="${p.id}">
                <td class="table-cell-muted-sm table-cell-nowrap">${escHtml(p.code)}</td>
                <td><strong>${escHtml(p.name)}</strong></td>
                <td class="text-muted">${escHtml(p.address || '—')}</td>
                <td class="text-muted">${escHtml(p.manager_name || '—')}</td>
                <td>${badge(p.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function openProject(id) {
  activeProjectId = id;
  resetProjectTabCache();
  const project = projectsList.find(p => p.id == id);
  if (!project) return;

  const titleEl = document.getElementById(isForemanProjectPage ? 'project-title' : 'modal-project-title');
  const metaEl = document.getElementById(isForemanProjectPage ? 'project-meta' : 'modal-project-meta');
  document.getElementById('foreman-project')?.classList.add('is-ready');

  titleEl.textContent = project.name;
  document.getElementById('sidebar-project-title').textContent = project.name;
  metaEl.innerHTML = isForemanProjectPage
    ? `
      ${badge(project.status)}
      <span>${escHtml(project.code)}</span>
      ${project.address ? `<span>${escHtml(project.address)}</span>` : ''}
      ${project.manager_name ? `<span>Менеджер: ${escHtml(project.manager_name)}</span>` : ''}
    `
    : `${badge(project.status)} <span class="supplier-modal-meta-code">${escHtml(project.code)}</span>` +
      (project.address ? ` · 📍 ${escHtml(project.address)}` : '');

  const initialTab = isForemanProjectPage
    ? new URLSearchParams(window.location.search).get('tab') || 'stages'
    : 'stages';
  const activeTab = TABS.includes(initialTab) ? initialTab : 'stages';
  const initialLoad = switchTab(activeTab, false, { force: true });
  if (!isForemanProjectPage) openModal('modal-project');
  if (isForemanProjectPage) {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }
  await initialLoad.catch(() => {});
  await preloadProjectTabs(activeTab);
}

// ─── Вкладки проекта ─────────────────────────────────────────
const TABS = ['stages', 'calendar', 'specs', 'work-specs', 'warehouse', 'docs'];

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, true));
});

function switchTab(tab, updateUrl = false, options = {}) {
  activeProjectTab = tab;
  if (isForemanProjectPage) {
    document.querySelectorAll('.sidebar .nav-item.active').forEach((item) => {
      item.classList.remove('active');
    });
  }

  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('is-hidden', t !== tab);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (btn.classList.contains('project-nav-item')) {
      btn.classList.toggle('active', t === tab);
    } else {
      btn.className = t === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    }
  });
  if (isForemanProjectPage && updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  }
  return loadProjectTabData(tab, options);
}

// ─── Форматирование этапов ───────────────────────────────────
function getForemanStageStatusLabel(stage) {
  return stage.is_from_vor
    ? VOR_STATUS_LABELS[stage.status] || stage.status || '—'
    : VOR_STATUS_LABELS[stage.status] || stage.status || '—';
}

function getForemanStageStatusClass(stage) {
  if (stage.status === 'done') return 'is-done';
  if (stage.status === 'in_progress') return 'is-progress';
  if (stage.status === 'not_done' || stage.status === 'rejected') return 'is-danger';
  return 'is-planned';
}

function isForemanVolumeStage(stage) {
  return Boolean(stage.is_from_vor) || Number(stage.planned_value) > 0;
}

function getForemanStageProgress(stage) {
  if (isForemanVolumeStage(stage) && Number(stage.planned_value) > 0) {
    return Math.min(100, Math.round((Number(stage.actual_value || 0) / Number(stage.planned_value)) * 100));
  }
  return stage.status === 'done' ? 100 : 0;
}

function formatForemanStagePlan(stage) {
  if (isForemanVolumeStage(stage)) {
    return stage.planned_date ? formatDate(stage.planned_date) : '—';
  }
  if (stage.planned_start && stage.planned_end) {
    return `${formatDate(stage.planned_start)} — ${formatDate(stage.planned_end)}`;
  }
  return stage.planned_start ? formatDate(stage.planned_start) : '—';
}

function formatForemanStageActual(stage) {
  const value = isForemanVolumeStage(stage) ? stage.actual_date : stage.actual_end;
  return value ? formatDate(value) : '—';
}

function formatForemanStageDetails(stage) {
  if (!isForemanVolumeStage(stage)) {
    return stage.planned_start || stage.planned_end
      ? formatForemanStagePlan(stage)
      : 'Плановые сроки не заданы';
  }

  const actual = stage.actual_value != null ? stage.actual_value : 0;
  const planned = stage.planned_value != null ? stage.planned_value : 0;
  const unit = escHtml(stage.unit || '');
  return `${actual} / ${planned}${unit ? ` ${unit}` : ''}`;
}

function getForemanStageNote(stage) {
  return stage.note || '—';
}

// ─── Этапы ───────────────────────────────────────────────────
async function loadStages(id) {
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/stages`);
  if (!ok) return;

  const list = document.getElementById('stages-list');
  const visibleStages = data.data.filter(s => !s.is_calendar_mobilization);
  currentStagesList = visibleStages;
  if (!visibleStages.length) {
    list.innerHTML = '<div class="foreman-stage-empty">Этапов нет. Сформируйте этапы из ВОР.</div>';
    return;
  }

  const vorStages = visibleStages.filter(s => isForemanVolumeStage(s) && Number(s.planned_value) > 0);
  const sumPlan = vorStages.reduce((a, s) => a + Number(s.planned_value), 0);
  const sumActual = vorStages.reduce((a, s) => a + Number(s.actual_value || 0), 0);
  const doneCount = visibleStages.filter(s => s.status === 'done').length;
  const progressPct = sumPlan > 0
    ? Math.min(100, Math.round(sumActual / sumPlan * 100))
    : Math.round(doneCount / visibleStages.length * 100);
  const inProgressCount = visibleStages.filter(s => s.status === 'in_progress').length;
  const problemCount = visibleStages.filter(s => s.status === 'not_done' || s.status === 'rejected').length;

  const progressHtml = `
    <div class="foreman-stage-overview">
      <div class="foreman-stage-progress-card">
        <div>
          <span>Готовность по этапам</span>
          <strong>${progressPct}%</strong>
        </div>
        <progress class="foreman-stage-progress-track" value="${progressPct}" max="100"></progress>
      </div>
      <div class="foreman-stage-stats">
        <div><span>Всего</span><strong>${visibleStages.length}</strong></div>
        <div><span>Выполнено</span><strong>${doneCount}</strong></div>
        <div><span>В работе</span><strong>${inProgressCount}</strong></div>
        <div><span>Проблемы</span><strong>${problemCount}</strong></div>
      </div>
    </div>`;

  list.innerHTML = progressHtml + visibleStages.map(s => {
    const isVor = Boolean(s.is_from_vor);
    const isVolume = isForemanVolumeStage(s);
    const statusLabel = getForemanStageStatusLabel(s);
    const statusClass = getForemanStageStatusClass(s);
    const stageProgress = getForemanStageProgress(s);
    const note = getForemanStageNote(s);

    return `
    <article class="foreman-stage-card ${isVor ? 'is-vor' : ''}" role="button" tabindex="0"
      data-action="edit-stage"
      data-id="${s.id}"
      data-name="${escHtml(s.name)}"
      data-status="${s.status}"
      data-is-vor="${isVor ? '1' : '0'}"
      data-is-volume="${isVolume ? '1' : '0'}"
      data-planned-value="${s.planned_value || ''}"
      data-actual-value="${s.actual_value || ''}"
      data-unit="${escHtml(s.unit || '')}"
      data-planned-date="${s.planned_date || ''}"
      data-actual-date="${s.actual_date || ''}"
      data-note="${escHtml(s.note || '')}"
      data-ps="${s.planned_start||''}" data-pe="${s.planned_end||''}" data-ae="${s.actual_end||''}">
      <div class="foreman-stage-main">
        <span class="foreman-stage-order">${s.order_num ?? 0}</span>
        <div class="foreman-stage-text">
          <div class="foreman-stage-name">${escHtml(s.name)}</div>
          <div class="foreman-stage-subline">${formatForemanStageDetails(s)}</div>
        </div>
      </div>
      <div class="foreman-stage-meta-grid">
        <div>
          <span>Плановые сроки</span>
          <strong>${formatForemanStagePlan(s)}</strong>
        </div>
        <div>
          <span>Факт окончания</span>
          <strong>${formatForemanStageActual(s)}</strong>
        </div>
        <div class="wide">
          <span>Примечание</span>
          <strong>${escHtml(note)}</strong>
        </div>
      </div>
      <div class="foreman-stage-status ${statusClass}">${escHtml(statusLabel)}</div>
      <div class="foreman-stage-progress-row">
        <progress class="foreman-stage-progress-track" value="${stageProgress}" max="100"></progress>
        <strong>${stageProgress}%</strong>
      </div>
    </article>`;
  }).join('');
}

document.getElementById('stages-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="edit-stage"]');
  if (!btn) return;
  activeStageId    = btn.dataset.id;
  activeStageIsVor = btn.dataset.isVor === '1';
  activeStageUsesVolume = btn.dataset.isVolume === '1';

  const f = document.getElementById('edit-stage-form');
  document.getElementById('edit-stage-name').value = btn.dataset.name;
  document.getElementById('edit-stage-name').readOnly = activeStageIsVor;
  f.note.value = btn.dataset.note || '';

  document.getElementById('edit-stage-regular').classList.toggle('is-hidden', activeStageUsesVolume);
  document.getElementById('edit-stage-vor').classList.toggle('is-hidden', !activeStageUsesVolume);

  if (activeStageUsesVolume) {
    f.actual_end.required = false;
    document.getElementById('edit-stage-actual-end-required').classList.add('is-hidden');
    document.getElementById('edit-stage-status-vor').value  = btn.dataset.status;
    document.getElementById('edit-stage-planned-val').value = btn.dataset.plannedValue;
    document.getElementById('edit-stage-unit').value        = btn.dataset.unit;
    f.actual_value.value  = btn.dataset.actualValue;
    f.planned_date.value  = btn.dataset.plannedDate;
    f.actual_date.value   = btn.dataset.actualDate;
    updateNoteRequired();
  } else {
    f.actual_date.required = false;
    document.getElementById('edit-stage-actual-date-required').classList.add('is-hidden');
    f.actual_value.value = '';
    f.planned_date.value = '';
    f.actual_date.value = '';
    document.getElementById('edit-stage-status-regular').value = btn.dataset.status;
    f.planned_start.value = btn.dataset.ps;
    f.planned_end.value   = btn.dataset.pe;
    f.actual_end.value    = btn.dataset.ae;
    updateRegularStageDateRequirements();
  }
  await window.ForemanStageDetails?.load(btn.dataset.id, activeProjectId);
  openModal('modal-edit-stage');
});

document.getElementById('stages-list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('[data-action="edit-stage"]');
  if (!card) return;
  e.preventDefault();
  card.click();
});

function updateNoteRequired() {
  const isNotDone = document.getElementById('edit-stage-status-vor').value === 'not_done';
  const isDone = document.getElementById('edit-stage-status-vor').value === 'done';
  const form = document.getElementById('edit-stage-form');
  const plannedDate = form.planned_date.value;
  const actualDate = form.actual_date.value;
  const isLate = plannedDate && actualDate && actualDate > plannedDate;
  document.getElementById('edit-stage-note-required').classList.toggle('is-hidden', !(isNotDone || isLate));
  form.note.required = isNotDone || isLate;
  form.actual_date.required = isDone;
  document.getElementById('edit-stage-actual-date-required').classList.toggle('is-hidden', !isDone);
}

function updateRegularStageDateRequirements() {
  const isDone = document.getElementById('edit-stage-status-regular').value === 'done';
  const form = document.getElementById('edit-stage-form');
  const plannedEnd = form.planned_end.value;
  const actualEnd = form.actual_end.value;
  const isLate = plannedEnd && actualEnd && actualEnd > plannedEnd;
  form.actual_end.required = isDone;
  form.note.required = isLate;
  document.getElementById('edit-stage-actual-end-required').classList.toggle('is-hidden', !isDone);
  document.getElementById('edit-stage-note-required').classList.toggle('is-hidden', !isLate);
}

document.getElementById('edit-stage-status-regular').addEventListener('change', updateRegularStageDateRequirements);
document.getElementById('edit-stage-status-vor').addEventListener('change', updateNoteRequired);
document.getElementById('edit-stage-form').planned_end.addEventListener('change', updateRegularStageDateRequirements);
document.getElementById('edit-stage-form').actual_end.addEventListener('change', updateRegularStageDateRequirements);
document.getElementById('edit-stage-form').planned_date.addEventListener('change', updateNoteRequired);
document.getElementById('edit-stage-form').actual_date.addEventListener('change', updateNoteRequired);

document.getElementById('btn-add-stage').addEventListener('click', () => {
  const project = projectsList.find(p => p.id == activeProjectId);
  openBatchModal(project?.name || '', 'этапы', 'Название этапа', async (items) => {
    const maxOrder = currentStagesList.reduce((max, stage) => {
      const order = Number(stage.order_num);
      return Number.isFinite(order) ? Math.max(max, order) : max;
    }, -1);
    let created = 0;

    for (const [index, item] of items.entries()) {
      const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/stages`, {
        name: item.name,
        order_num: maxOrder + index + 1,
        planned_value: item.quantity,
        unit: item.unit || undefined,
      });
      if (!ok) {
        showToast(data.error || 'Не удалось добавить этап', 'error');
        break;
      }
      created += 1;
    }

    if (created) {
      showToast(`Добавлено этапов: ${created}`, 'success');
      closeModal('modal-batch');
      reloadProjectTab('stages');
    }
  }, { mode: 'stages', saveText: 'Сохранить этапы' });
});

document.getElementById('edit-stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  let body = {};

  if (activeStageUsesVolume) {
    const status = document.getElementById('edit-stage-status-vor').value;
    body.status = status;
    body.name   = document.getElementById('edit-stage-name').value;
    const av = fd.get('actual_value');
    if (av !== '' && av !== null) body.actual_value = parseFloat(av);
    const pd = fd.get('planned_date');
    if (pd) body.planned_date = pd;
    const ad = fd.get('actual_date');
    if (ad) body.actual_date = ad;
    const note = fd.get('note');
    if (note) body.note = note;
    if (status === 'not_done' && !note) {
      showToast('Заполните примечание для статуса «Не выполнено»', 'error');
      return;
    }
    if (status === 'done' && !fd.get('actual_date')) {
      showToast('Для выполненной работы укажите фактическое окончание', 'error');
      return;
    }
    if (pd && ad && ad > pd && !note) {
      showToast('При просрочке укажите пояснение в примечании', 'error');
      return;
    }
  } else {
    body.name = document.getElementById('edit-stage-name').value;
    body.status = document.getElementById('edit-stage-status-regular').value;
    const plannedStart = fd.get('planned_start');
    const plannedEnd = fd.get('planned_end');
    const actualEnd = fd.get('actual_end');

    if (body.status === 'done' && !actualEnd) {
      showToast('Для завершённого этапа укажите фактическое окончание', 'error');
      return;
    }
    const note = fd.get('note');
    if (plannedEnd && actualEnd && actualEnd > plannedEnd && !note) {
      showToast('При просрочке укажите пояснение в примечании', 'error');
      return;
    }

    if (plannedStart) body.planned_start = plannedStart;
    if (plannedEnd) body.planned_end = plannedEnd;
    if (actualEnd) body.actual_end = actualEnd;
    if (note) body.note = note;
  }

  const { ok, data } = await apiRequest('PUT', `/api/foreman/stages/${activeStageId}`, body);
  if (ok) {
    showToast('Этап обновлён', 'success');
    closeModal('modal-edit-stage');
    reloadProjectTab('stages');
  } else showToast(data.error, 'error');
});

// ─── ВОР: ведомость объёмов работ ────────────────────────────
async function loadWorkSpecs(id) {
  const container = document.getElementById('work-specs-list');
  container.innerHTML = '<div class="text-muted">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/work-specs`);
  if (!ok) { container.innerHTML = '<div class="text-danger">Ошибка загрузки</div>'; return; }

  const project = projectsList.find(p => p.id == id);
  const generated = project?.stages_generated;
  const kpSent = Boolean(project?.kp_sent_at);

  const btnGenerate = document.getElementById('btn-generate-stages');
  const btnAdd      = document.getElementById('btn-add-work-spec');

  btnGenerate.classList.toggle('is-hidden', generated || !data.data.length);
  btnGenerate.disabled = !kpSent;
  btnGenerate.title = kpSent ? '' : 'Сначала менеджер должен отправить КП заказчику';
  btnAdd.classList.toggle('is-hidden', generated);

  const specs = data.data;
  if (!specs.length) {
    container.innerHTML = '<div class="text-muted">Позиций нет. Добавьте объёмы работ.</div>';
    return;
  }

  const readonly = generated
    ? '<div class="manager-modal-muted-note">ВОР заблокирован — этапы уже сформированы.</div>'
    : !kpSent
      ? '<div class="manager-modal-muted-note">Этапы можно сформировать после отправки КП заказчику.</div>'
    : '';

  container.innerHTML = readonly + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол-во</th><th>Статус</th></tr>
        </thead>
        <tbody>
          ${specs.map((s, i) => `
            <tr>
              <td class="table-cell-muted-sm">${i + 1}</td>
              <td><strong>${escHtml(s.work_name)}</strong></td>
              <td>${escHtml(s.unit || '—')}</td>
              <td>${s.quantity}</td>
              <td>${badge(s.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById('btn-generate-stages').addEventListener('click', async () => {
  const project = projectsList.find(p => p.id == activeProjectId);
  if (!project?.kp_sent_at) {
    showToast('Сначала менеджер должен отправить КП заказчику', 'error');
    return;
  }
  if (!confirm('Этапы будут сформированы из ВОР. ВОР станет недоступен для редактирования. Продолжить?')) return;
  const btn = document.getElementById('btn-generate-stages');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/stages/generate-from-vor`);
  btn.disabled = false;
  if (ok) {
    showToast(`Создано этапов: ${data.data.length}`, 'success');
    const project = projectsList.find(p => p.id == activeProjectId);
    if (project) project.stages_generated = true;
    reloadProjectTab('work-specs');
    invalidateProjectTabs('stages', 'calendar');
  } else showToast(data.error, 'error');
});

document.getElementById('btn-add-work-spec').addEventListener('click', () => {
  const project = projectsList.find(p => p.id == activeProjectId);
  openBatchModal(project?.name || '', 'ВОР', 'Наименование работы', async (items) => {
    const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/work-specs/batch`, { items });
    if (ok) {
      showToast(`Добавлено позиций: ${data.data.inserted}`, 'success');
      closeModal('modal-batch');
      reloadProjectTab('work-specs');
    } else showToast(data.error, 'error');
  });
});

// ─── Табличное добавление ВОР и этапов ────────────────────────
const BATCH_UNITS = ['шт', 'м', 'м²', 'км', 'компл', 'рул', 'кг', 'т', 'л'];
let batchSaveCallback = null;
let batchMode = 'work-specs';
let batchSaveText = 'Сохранить в проект';

function batchUnitOptions() {
  return '<option value="">—</option>' +
    BATCH_UNITS.map(u => `<option value="${u}">${escHtml(u)}</option>`).join('');
}

function addBatchRow() {
  const tbody = document.getElementById('batch-tbody');
  const rowNum = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  const isStagesMode = batchMode === 'stages';
  tr.innerHTML = `
    <td class="batch-cell-index">${rowNum}</td>
    <td class="batch-cell-wrap">
      <input type="text" class="batch-cell batch-name" placeholder="${isStagesMode ? 'Название этапа' : 'Наименование работы'}">
    </td>
    <td class="batch-cell-wrap batch-work-field">
      <select class="batch-cell batch-unit">
        ${batchUnitOptions()}
      </select>
    </td>
    <td class="batch-cell-wrap batch-work-field">
      <input type="number" class="batch-cell batch-qty" placeholder="0" min="0.001" step="any">
    </td>
  `;
  tbody.appendChild(tr);
  updateBatchCounter();
  return tr;
}

function updateBatchCounter() {
  const rows = document.querySelectorAll('#batch-tbody tr');
  let filled = 0;
  rows.forEach(tr => {
    const name = tr.querySelector('.batch-name').value.trim();
    const qty = tr.querySelector('.batch-qty')?.value;
    if (name && qty) filled++;
  });
  const label = batchMode === 'stages'
    ? (filled % 10 === 1 && filled % 100 !== 11 ? 'этап' : filled % 10 >= 2 && filled % 10 <= 4 && (filled % 100 < 10 || filled % 100 >= 20) ? 'этапа' : 'этапов')
    : (filled % 10 === 1 && filled % 100 !== 11 ? 'позиция' : filled % 10 >= 2 && filled % 10 <= 4 && (filled % 100 < 10 || filled % 100 >= 20) ? 'позиции' : 'позиций');
  document.getElementById('batch-counter').textContent = `${filled} ${label} заполнено`;
}

function openBatchModal(projectName, type, namePlaceholder, saveCallback, options = {}) {
  batchMode = options.mode || 'work-specs';
  batchSaveText = options.saveText || 'Сохранить в проект';
  const isStagesMode = batchMode === 'stages';
  document.getElementById('batch-modal-title').textContent = isStagesMode
    ? 'Добавить этапы'
    : `Добавить позиции — ${type}`;
  document.getElementById('batch-modal-subtitle').textContent = projectName;
  batchSaveCallback = saveCallback;
  document.getElementById('btn-batch-save').textContent = batchSaveText;
  document.querySelectorAll('#modal-batch .batch-work-field').forEach((el) => {
    el.classList.remove('is-hidden');
  });

  const tbody = document.getElementById('batch-tbody');
  tbody.innerHTML = '';
  for (let i = 0; i < 5; i++) addBatchRow();
  tbody.querySelectorAll('.batch-name').forEach(el => { el.placeholder = namePlaceholder || 'Наименование'; });

  updateBatchCounter();
  openModal('modal-batch');
  tbody.querySelector('.batch-name').focus();
}

document.getElementById('modal-batch').addEventListener('keydown', e => {
  const cell = e.target;
  if (!cell.classList.contains('batch-cell')) return;
  if (e.key !== 'Tab' && e.key !== 'Enter') return;
  e.preventDefault();
  const cells = [...document.getElementById('modal-batch').querySelectorAll('.batch-cell')]
    .filter(el => el.offsetParent !== null);
  const idx = cells.indexOf(cell);
  if (idx === cells.length - 1) {
    const tr = addBatchRow();
    tr.querySelector('.batch-name').focus();
  } else {
    cells[idx + 1].focus();
  }
});

document.getElementById('batch-tbody').addEventListener('input', updateBatchCounter);

document.getElementById('modal-batch').addEventListener('paste', e => {
  const cell = e.target;
  if (!cell.classList.contains('batch-cell')) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;

  const pasteRows = text.trim().split(/\r?\n/).map(r => r.split('\t'));
  const tbody = document.getElementById('batch-tbody');
  const allTrs = [...tbody.querySelectorAll('tr')];
  const currentTr = cell.closest('tr');
  let startIdx = allTrs.indexOf(currentTr);
  if (startIdx === -1) startIdx = 0;

  pasteRows.forEach((cols, ri) => {
    let tr = allTrs[startIdx + ri];
    if (!tr) { tr = addBatchRow(); allTrs.push(tr); }
    if (cols[0] !== undefined) tr.querySelector('.batch-name').value = cols[0].trim();
    if (cols[1] !== undefined) {
      const unitVal = cols[1].trim();
      const sel = tr.querySelector('.batch-unit');
      if (unitVal && !BATCH_UNITS.includes(unitVal)) sel.add(new Option(unitVal, unitVal));
      sel.value = unitVal;
    }
    if (cols[2] !== undefined) {
      const qty = parseFloat(cols[2].replace(',', '.'));
      if (!isNaN(qty)) tr.querySelector('.batch-qty').value = qty;
    }
  });
  updateBatchCounter();
});

document.getElementById('btn-batch-add-row').addEventListener('click', () => {
  const tr = addBatchRow();
  tr.querySelector('.batch-name').focus();
});

document.getElementById('btn-batch-save').addEventListener('click', async () => {
  const items = [];
  document.querySelectorAll('#batch-tbody tr').forEach(tr => {
    const name = tr.querySelector('.batch-name').value.trim();
    const unit = tr.querySelector('.batch-unit').value.trim();
    const qty  = parseFloat(tr.querySelector('.batch-qty').value);
    if (batchMode === 'stages') {
      if (name && qty > 0) items.push({ name, unit: unit || undefined, quantity: qty });
      return;
    }
    if (name && qty > 0) items.push({ work_name: name, unit: unit || undefined, quantity: qty });
  });
  if (!items.length) {
    showToast(batchMode === 'stages' ? 'Заполните хотя бы один этап' : 'Заполните хотя бы одну позицию', 'error');
    return;
  }

  const btn = document.getElementById('btn-batch-save');
  btn.disabled = true; btn.textContent = 'Сохранение...';
  if (batchSaveCallback) await batchSaveCallback(items);
  btn.disabled = false; btn.textContent = batchSaveText;
});

// ─── Документы (вкладка проекта) ──────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

document.getElementById('btn-create-mtr')?.addEventListener('click', async () => {
  if (!projectsList.length) await loadProjects();
  const sel = document.getElementById('mtr-project-select');
  if (!sel) return;
  const availableProjects = isForemanProjectPage && activeProjectId
    ? projectsList.filter(p => p.id == activeProjectId)
    : projectsList;
  sel.innerHTML = availableProjects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  await updateMtrStages();
  document.getElementById('mtr-form').reset();
  openModal('modal-mtr');
});

document.getElementById('mtr-project-select')?.addEventListener('change', updateMtrStages);

async function updateMtrStages() {
  const projectId = document.getElementById('mtr-project-select')?.value;
  if (!projectId) return;
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/stages`);
  const sel = document.getElementById('mtr-stage-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— без этапа —</option>';
  if (ok) sel.innerHTML += data.data.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

document.getElementById('mtr-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const projectId = body.project_id;
  delete body.project_id;
  body.quantity = parseFloat(body.quantity);
  if (!body.stage_id) delete body.stage_id;
  else body.stage_id = parseInt(body.stage_id);
  if (!body.unit)  delete body.unit;
  if (!body.notes) delete body.notes;

  const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${projectId}/mtr-requests`, body);
  if (ok) {
    showToast('Заявка отправлена', 'success');
    closeModal('modal-mtr');
    if (document.getElementById('section-mtr')?.classList.contains('active')) window.foremanDashboardLoadMtrAll?.();
  } else showToast(data.error, 'error');
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
      if (batchMode === 'stages') return;
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
      if (batchMode === 'stages') return;
      if (e.target.classList.contains('batch-name') && !e.target.hasAttribute('list')) {
         e.target.setAttribute('list', 'catalog-datalist');
      }
    });
  }
}

window.initForeman = init;
