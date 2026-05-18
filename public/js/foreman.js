const SPEC_STATUS = {
  draft: 'Черновик', pending_approval: 'На согласовании',
  approved: 'Согласовано', rejected: 'Отклонено',
};
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
let activeWarehouseId = null;
let activeSpecId      = null;
let activeWriteoffProjectId = null;
let rejectSpecMode = 'single';
let stageWriteoffItems = [];
let calendarPlan = null;
let calendarRangeDraft = null;
let currentStagesList = [];
let foremanPageMode = window.FOREMAN_PAGE_MODE || 'dashboard';
let isForemanProjectPage = foremanPageMode === 'project';

function getPendingSpecCheckboxes() {
  return Array.from(document.querySelectorAll('#specs-list .spec-approve-checkbox'));
}

function updateSpecBulkActions() {
  const checkboxes = getPendingSpecCheckboxes();
  const actionWrap = document.getElementById('specs-bulk-actions');
  const counter = document.getElementById('specs-bulk-counter');

  if (!checkboxes.length) {
    actionWrap.style.display = 'none';
    counter.textContent = '0 отмечено';
    return;
  }

  const checkedCount = checkboxes.filter((input) => input.checked).length;
  const selectAll = document.getElementById('spec-select-all');
  if (selectAll) {
    selectAll.checked = checkedCount === checkboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }
  actionWrap.style.display = 'flex';
  counter.textContent = `${checkedCount} отмечено из ${checkboxes.length}`;
}

// ─── Инициализация ────────────────────────────────────────────
async function init(mode = window.FOREMAN_PAGE_MODE || 'dashboard') {
  try {
    foremanPageMode = mode;
    isForemanProjectPage = foremanPageMode === 'project';
    currentUser = await requireAuth('foreman');
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initCatalogAutocomplete('foreman');
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
    startWarehouseWriteoff,
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
    container.innerHTML = `<div class="card" style="color:var(--muted);text-align:center;padding:2rem">
      Нет проектов. Войдите по коду от менеджера.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
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
              <tr style="cursor:pointer" data-action="open-project" data-id="${p.id}">
                <td style="color:var(--muted);white-space:nowrap">${escHtml(p.code)}</td>
                <td><strong>${escHtml(p.name)}</strong></td>
                <td style="color:var(--muted)">${escHtml(p.address || '—')}</td>
                <td style="color:var(--muted)">${escHtml(p.manager_name || '—')}</td>
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
    : `${badge(project.status)} <span style="margin-left:.5rem">${escHtml(project.code)}</span>` +
      (project.address ? ` · 📍 ${escHtml(project.address)}` : '');

  const initialTab = isForemanProjectPage
    ? new URLSearchParams(window.location.search).get('tab') || 'stages'
    : 'stages';
  switchTab(TABS.includes(initialTab) ? initialTab : 'stages', false);
  if (!isForemanProjectPage) openModal('modal-project');
  await loadStages(id);
  if (isForemanProjectPage) {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }
}

// ─── Вкладки проекта ─────────────────────────────────────────
const TABS = ['stages', 'calendar', 'specs', 'work-specs', 'warehouse', 'docs'];

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, true));
});

function switchTab(tab, updateUrl = false) {
  if (isForemanProjectPage) {
    document.querySelectorAll('.sidebar .nav-item.active').forEach((item) => {
      item.classList.remove('active');
    });
  }

  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? '' : 'none';
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
  if (tab === 'specs')       loadProjectSpecs(activeProjectId);
  if (tab === 'calendar')    loadCalendarPlan(activeProjectId);
  if (tab === 'work-specs')  loadWorkSpecs(activeProjectId);
  if (tab === 'warehouse')   loadProjectWarehouse(activeProjectId);
  if (tab === 'docs')        loadProjectDocs(activeProjectId);
}

// ─── Календарный план ────────────────────────────────────────
function addCalendarDays(dateOnly, days) {
  const [year, month, day] = String(dateOnly).slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getLocalDateOnly(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCalendarDayInfo(day) {
  const dateOnly = addCalendarDays(calendarPlan.calendar_start, day - 1);
  const [year, month, date] = dateOnly.split('-').map(Number);
  const weekDay = new Date(year, month - 1, date).getDay();
  return {
    dateOnly,
    label: `${String(date).padStart(2, '0')}.${String(month).padStart(2, '0')}`,
    isWeekend: weekDay === 0 || weekDay === 6,
    isToday: dateOnly === getLocalDateOnly(),
  };
}

function calendarDayIndex(dateOnly) {
  if (!calendarPlan?.calendar_start || !dateOnly) return null;
  const [fromYear, fromMonth, fromDay] = String(calendarPlan.calendar_start).slice(0, 10).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(dateOnly).slice(0, 10).split('-').map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86400000) + 1;
}

function calendarDateDiffDays(fromDateOnly, toDateOnly) {
  if (!fromDateOnly || !toDateOnly) return 0;
  const [fromYear, fromMonth, fromDay] = String(fromDateOnly).slice(0, 10).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(toDateOnly).slice(0, 10).split('-').map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86400000);
}

function getCalendarItemRange(item) {
  const start = calendarDayIndex(item.planned_start);
  const end = calendarDayIndex(item.planned_end);
  if (!start || !end) return null;
  if (end < 1 || start > calendarPlan.duration_days) return null;
  return {
    start: Math.max(1, Math.min(start, end)),
    end: Math.min(calendarPlan.duration_days, Math.max(start, end)),
  };
}

function getCalendarItemProgress(item) {
  if (item.planned_value) {
    return Math.min(100, Math.round((Number(item.actual_value || 0) / Number(item.planned_value)) * 100));
  }
  return item.status === 'done' ? 100 : 0;
}

function isCalendarItemDone(item) {
  return item.status === 'done' || getCalendarItemProgress(item) >= 100;
}

function getCalendarItemActualEnd(item) {
  return item.actual_date || item.actual_end || null;
}

function getCalendarItemDelayDays(item) {
  const actualEnd = getCalendarItemActualEnd(item);
  if (!item.planned_end || !actualEnd) return 0;
  return Math.max(0, calendarDateDiffDays(item.planned_end, actualEnd));
}

function isCalendarItemActiveOverdue(item) {
  if (!item.planned_end || isCalendarItemDone(item)) return false;
  return String(item.planned_end).slice(0, 10) < getLocalDateOnly();
}

function isCalendarItemOverdue(item) {
  return isCalendarItemActiveOverdue(item) || getCalendarItemDelayDays(item) > 0;
}

function getCalendarStatusClass(item) {
  if (isCalendarItemOverdue(item) || item.status === 'not_done') return 'is-danger';
  if (isCalendarItemDone(item)) return 'is-done';
  if (item.status === 'in_progress') return 'is-progress';
  return 'is-planned';
}

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

function buildCalendarPhaseRows(items) {
  const rows = [];
  const mobilization = items.filter(item => item.is_calendar_mobilization);
  const works = items.filter(item => !item.is_calendar_mobilization);

  if (mobilization.length) {
    rows.push(...mobilization);
  }

  if (works.length) {
    if (mobilization.length) {
      rows.push(createCalendarPhaseRow('works', 'Основные работы', `${works.length} этапов`, works));
    }
    rows.push(...works);
  }

  return rows;
}

function createCalendarPhaseRow(key, title, subtitle, items) {
  const planned = items.filter(item => item.planned_start && item.planned_end);
  const starts = planned.map(item => item.planned_start).sort();
  const ends = planned.map(item => item.planned_end).sort();
  const progress = items.length
    ? Math.round(items.reduce((sum, item) => sum + getCalendarItemProgress(item), 0) / items.length)
    : 0;

  return {
    type: 'phase',
    key,
    name: title,
    subtitle,
    planned_start: starts[0] || null,
    planned_end: ends[ends.length - 1] || null,
    progress,
    is_overdue: items.some(isCalendarItemOverdue),
  };
}

function getCalendarPlanStats(items) {
  const plannedCount = items.filter(item => item.planned_start && item.planned_end).length;
  const mobilizationCount = items.filter(item => item.is_calendar_mobilization).length;
  return {
    plannedCount,
    workCount: items.length - mobilizationCount,
  };
}

async function loadCalendarPlan(id) {
  calendarRangeDraft = null;
  const container = document.getElementById('calendar-plan-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/calendar-plan`);
  if (!ok) {
    container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки календарного плана</span>';
    return;
  }
  calendarPlan = data.data;
  updateCalendarSummary();
  updateCalendarActions();
  renderCalendarPlan();
}

function updateCalendarSummary() {
  const summary = document.getElementById('calendar-plan-summary');
  if (!summary || !calendarPlan) return;
  const items = calendarPlan.items || [];
  const stats = getCalendarPlanStats(items);
  summary.textContent = items.length
    ? `${stats.plannedCount} из ${items.length} строк запланированы · работы: ${stats.workCount} · старт: ${formatDate(calendarPlan.calendar_start)} · горизонт: ${calendarPlan.duration_days} дней.`
    : 'Календарный план ещё не сформирован. Нажмите кнопку справа.';
}

function updateCalendarActions() {
  const generateBtn = document.getElementById('btn-generate-calendar-plan');
  if (!generateBtn || !calendarPlan) return;
  const items = calendarPlan.items || [];
  const hasMobilization = items.some(item => item.is_calendar_mobilization);
  generateBtn.style.display = hasMobilization ? 'none' : '';
}

function renderCalendarPlan() {
  const container = document.getElementById('calendar-plan-list');
  const days = Array.from({ length: calendarPlan.duration_days }, (_, i) => i + 1);
  const items = calendarPlan.items || [];

  if (!items.length) {
    container.innerHTML = `
      <div class="calendar-plan-empty">
        <strong>Календарный план ещё не сформирован</strong>
        <span>Будет создана строка мобилизации и работы из ВОР. Старт берётся от даты подписания договора.</span>
      </div>`;
    return;
  }

  const nameCol = 440;
  const dayCol = 32;
  const gridWidth = nameCol + days.length * dayCol;
  const rows = buildCalendarPhaseRows(items);

  container.innerHTML = `
    <div class="calendar-plan-toolbar">
      <div class="calendar-plan-legend">
        <span><i class="calendar-legend-work"></i>Работы</span>
        <span><i class="calendar-legend-mobilization"></i>Мобилизация</span>
        <span><i class="calendar-legend-overdue"></i>Просрочка</span>
        <span><i class="calendar-legend-today"></i>Сегодня</span>
      </div>
      <div class="calendar-plan-hint">Выберите начало и окончание в одной строке.</div>
    </div>
    <div class="calendar-plan-shell">
      <div class="calendar-plan-grid" style="grid-template-columns:${nameCol}px repeat(${days.length},${dayCol}px);min-width:${gridWidth}px">
        <div class="calendar-plan-head calendar-plan-sticky-left">Работы</div>
        ${days.map(day => {
          const dayInfo = getCalendarDayInfo(day);
          return `
          <div class="calendar-plan-day-head ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}">
            <div>${day}</div>
            <span>${dayInfo.label}</span>
          </div>`;
        }).join('')}
        ${rows.map(row => row.type === 'phase' ? renderCalendarPhaseRow(row, days) : renderCalendarRow(row, days)).join('')}
      </div>
    </div>`;
}

function renderCalendarPhaseRow(row, days) {
  const rangeText = row.planned_start && row.planned_end
    ? `${formatDate(row.planned_start)} — ${formatDate(row.planned_end)}`
    : 'Диапазон не задан';

  return `
    <div class="calendar-plan-left calendar-plan-sticky-left calendar-phase-left ${row.is_overdue ? 'is-overdue' : ''}">
      <div class="calendar-phase-title">${escHtml(row.name)}</div>
      <div class="calendar-phase-meta">${escHtml(row.subtitle)} · ${rangeText}</div>
    </div>
    ${days.map(day => {
      const dayInfo = getCalendarDayInfo(day);
      return `
        <div class="calendar-cell calendar-phase-cell ${row.is_overdue ? 'is-overdue' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}"></div>`;
    }).join('')}`;
}

function renderCalendarRow(item, days) {
  const range = getCalendarItemRange(item);
  const isMobilization = item.is_calendar_mobilization;
  const actual = getCalendarItemActualEnd(item);
  const dates = item.planned_start && item.planned_end
    ? `${formatDate(item.planned_start)} — ${formatDate(item.planned_end)}`
    : 'Диапазон не задан';
  const progress = getCalendarItemProgress(item);
  const delayDays = getCalendarItemDelayDays(item);
  const isDelayed = delayDays > 0;
  const isActiveOverdue = isCalendarItemActiveOverdue(item);
  const hasDeadlineIssue = isActiveOverdue || isDelayed;
  const statusLabel = VOR_STATUS_LABELS[item.status] || item.status || '—';
  const deadlineLabel = isDelayed ? `Просрочка +${delayDays} дн.` : 'Просрочка';
  const stageNameClass = isMobilization
    ? 'calendar-stage-name calendar-stage-name-fixed'
    : 'calendar-stage-name';
  const statusClass = getCalendarStatusClass(item);
  const actualDay = actual ? calendarDayIndex(actual) : null;
  const delayEndDay = actualDay ? Math.min(calendarPlan.duration_days, actualDay) : null;

  return `
    <div class="calendar-plan-left calendar-plan-sticky-left ${isMobilization ? 'is-mobilization' : ''} ${hasDeadlineIssue ? 'is-overdue' : ''}">
      <div class="calendar-stage-row-main">
        <div class="calendar-stage-text">
          <div class="${stageNameClass}">${escHtml(item.name)}</div>
          <div class="calendar-stage-meta">${dates}${actual ? ` · факт: ${formatDate(actual)}` : ''}${isDelayed ? ` · +${delayDays} дн.` : ''}${isActiveOverdue ? ' · просрочено' : ''}</div>
        </div>
        <div class="calendar-stage-badges">
          <span class="calendar-stage-progress ${hasDeadlineIssue ? 'is-danger' : ''}">${progress}%</span>
          <span class="calendar-stage-status ${statusClass}">${escHtml(hasDeadlineIssue ? deadlineLabel : statusLabel)}</span>
        </div>
      </div>
    </div>
    ${days.map(day => {
      const dayInfo = getCalendarDayInfo(day);
      const selected = range && day >= range.start && day <= range.end;
      const isStart = selected && day === range.start;
      const isEnd = selected && day === range.end;
      const isDelayTail = isDelayed && range && delayEndDay && day > range.end && day <= delayEndDay;
      const isDelayStart = isDelayTail && day === range.end + 1;
      const isDelayEnd = isDelayTail && day === delayEndDay;
      return `
        <button type="button"
          class="calendar-cell ${selected ? 'selected' : ''} ${isStart ? 'range-start' : ''} ${isEnd ? 'range-end' : ''} ${isActiveOverdue ? 'is-overdue' : ''} ${isDelayTail ? 'delay-tail' : ''} ${isDelayStart ? 'delay-start' : ''} ${isDelayEnd ? 'delay-end' : ''} ${isMobilization ? 'mobilization' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}"
          data-id="${item.id}"
          data-day="${day}"
          title="${escHtml(item.name)} · ${formatDate(dayInfo.dateOnly)}${isDelayTail ? ` · просрочка +${delayDays} дн.` : ''}">
          <span style="--calendar-progress:${progress}%"></span>
        </button>`;
    }).join('')}`;
}

async function saveCalendarRange(itemId, startDay, endDay) {
  const item = calendarPlan.items.find(row => String(row.id) === String(itemId));
  if (!item) return;
  const from = Math.min(startDay, endDay);
  const to = Math.max(startDay, endDay);
  const body = {
    planned_start: addCalendarDays(calendarPlan.calendar_start, from - 1),
    planned_end: addCalendarDays(calendarPlan.calendar_start, to - 1),
  };
  const { ok, data } = await apiRequest('PUT', `/api/foreman/calendar-plan/items/${itemId}`, body);
  if (!ok) {
    showToast(data.error, 'error');
    return;
  }
  showToast('Диапазон сохранён', 'success');
  await loadCalendarPlan(activeProjectId);
}

document.getElementById('calendar-plan-list').addEventListener('click', async (e) => {
  const cell = e.target.closest('.calendar-cell');
  if (!cell) return;
  const itemId = cell.dataset.id;
  const day = parseInt(cell.dataset.day, 10);

  if (!calendarRangeDraft || calendarRangeDraft.itemId !== itemId) {
    calendarRangeDraft = { itemId, day };
    document.querySelectorAll('.calendar-cell.range-draft').forEach((draftCell) => draftCell.classList.remove('range-draft'));
    cell.classList.add('range-draft');
    showToast('Выберите последний день диапазона', 'info');
    return;
  }

  await saveCalendarRange(itemId, calendarRangeDraft.day, day);
  calendarRangeDraft = null;
});

document.getElementById('btn-generate-calendar-plan').addEventListener('click', async () => {
  const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/calendar-plan/generate`);
  if (!ok) {
    showToast(data.error, 'error');
    return;
  }
  calendarPlan = data.data;
  updateCalendarSummary();
  updateCalendarActions();
  renderCalendarPlan();
  const count = calendarPlan.items?.length || 0;
  showToast(`Календарный план сформирован: ${count} строк`, 'success');
});

document.getElementById('btn-export-calendar-plan').addEventListener('click', () => {
  if (!calendarPlan?.items?.length) {
    showToast('Сначала сформируйте календарный план', 'error');
    return;
  }
  const rows = [
    ['Этап', 'Плановое начало', 'Плановое окончание', 'Фактическое окончание', 'Статус'],
    ...calendarPlan.items.map(item => [
      item.name,
      item.planned_start ? formatDate(item.planned_start) : '',
      item.planned_end ? formatDate(item.planned_end) : '',
      item.actual_date || item.actual_end ? formatDate(item.actual_date || item.actual_end) : '',
      VOR_STATUS_LABELS[item.status] || item.status,
    ]),
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calendar-plan-${activeProjectId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

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
        <div class="foreman-stage-progress-track">
          <span style="width:${progressPct}%"></span>
        </div>
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
        <div class="foreman-stage-progress-track">
          <span style="width:${stageProgress}%"></span>
        </div>
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

  document.getElementById('edit-stage-regular').style.display = activeStageUsesVolume ? 'none' : '';
  document.getElementById('edit-stage-vor').style.display     = activeStageUsesVolume ? '' : 'none';

  if (activeStageUsesVolume) {
    f.actual_end.required = false;
    document.getElementById('edit-stage-actual-end-required').style.display = 'none';
    document.getElementById('edit-stage-status-vor').value  = btn.dataset.status;
    document.getElementById('edit-stage-planned-val').value = btn.dataset.plannedValue;
    document.getElementById('edit-stage-unit').value        = btn.dataset.unit;
    f.actual_value.value  = btn.dataset.actualValue;
    f.planned_date.value  = btn.dataset.plannedDate;
    f.actual_date.value   = btn.dataset.actualDate;
    updateNoteRequired();
  } else {
    f.actual_date.required = false;
    document.getElementById('edit-stage-actual-date-required').style.display = 'none';
    f.actual_value.value = '';
    f.planned_date.value = '';
    f.actual_date.value = '';
    document.getElementById('edit-stage-status-regular').value = btn.dataset.status;
    f.planned_start.value = btn.dataset.ps;
    f.planned_end.value   = btn.dataset.pe;
    f.actual_end.value    = btn.dataset.ae;
    updateRegularStageDateRequirements();
  }
  await loadStageWriteoffPanel(btn.dataset.id, activeProjectId);
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
  document.getElementById('edit-stage-note-required').style.display = (isNotDone || isLate) ? '' : 'none';
  form.note.required = isNotDone || isLate;
  form.actual_date.required = isDone;
  document.getElementById('edit-stage-actual-date-required').style.display = isDone ? '' : 'none';
}

function updateRegularStageDateRequirements() {
  const isDone = document.getElementById('edit-stage-status-regular').value === 'done';
  const form = document.getElementById('edit-stage-form');
  const plannedEnd = form.planned_end.value;
  const actualEnd = form.actual_end.value;
  const isLate = plannedEnd && actualEnd && actualEnd > plannedEnd;
  form.actual_end.required = isDone;
  form.note.required = isLate;
  document.getElementById('edit-stage-actual-end-required').style.display = isDone ? '' : 'none';
  document.getElementById('edit-stage-note-required').style.display = isLate ? '' : 'none';
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
      loadStages(activeProjectId);
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
    loadStages(activeProjectId);
  } else showToast(data.error, 'error');
});

// ─── Ведомость материалов (вкладка в модалке) ─────────────────
async function loadProjectSpecs(id) {
  const container = document.getElementById('specs-list');
  container.innerHTML = '<div style="color:var(--muted)">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/specs`);
  if (!ok) {
    container.innerHTML = '<div style="color:var(--danger)">Ошибка загрузки</div>';
    updateSpecBulkActions();
    return;
  }

  const specs = data.data;
  const hasPendingSpecs = specs.some((s) => s.status === 'pending_approval');
  if (!specs.length) {
    container.innerHTML = '<div style="color:var(--muted)">Ведомость пуста. Снабженец ещё не отправил материалы.</div>';
    updateSpecBulkActions();
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <colgroup>
          <col style="width:42%">
          <col style="width:14%">
          <col style="width:14%">
          <col style="width:14%">
          <col style="width:16%">
        </colgroup>
        <thead>
          <tr>
            <th>
              <label style="display:flex;align-items:center;gap:.65rem">
                ${hasPendingSpecs ? '<input type="checkbox" id="spec-select-all" aria-label="Выбрать все позиции ВОМ">' : '<span style="width:16px;display:inline-block"></span>'}
                <span>Материал</span>
              </label>
            </th>
            <th style="text-align:right">Нужно</th>
            <th style="text-align:right">Поступило</th>
            <th style="text-align:right">Осталось</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          ${specs.map((s) => `
            <tr>
              <td>
                <div style="display:flex;align-items:flex-start;gap:.65rem;min-width:0">
                  ${s.status === 'pending_approval' ? `
                    <label style="padding-top:.15rem">
                      <input type="checkbox" class="spec-approve-checkbox" value="${s.id}">
                    </label>
                  ` : '<div style="width:16px"></div>'}
                  <div style="min-width:0">
                    <div style="font-weight:500;line-height:1.35">${escHtml(s.material_name)}</div>
                    <div style="color:var(--muted);font-size:.74rem;line-height:1.35;margin-top:.28rem;opacity:.9">
                      ${escHtml(s.supplier_name)}
                      ${s.rejection_note ? ` · <span style="color:var(--danger)">Отклонено: ${escHtml(s.rejection_note)}</span>` : ''}
                      ${s.approved_at ? ` · Согласовано ${formatDate(s.approved_at)}` : ''}
                    </div>
                  </div>
                </div>
              </td>
              <td style="text-align:right">${s.quantity} ${escHtml(s.unit || '')}</td>
              <td style="text-align:right">${s.supplied_qty || 0}</td>
              <td style="text-align:right">${s.remaining_qty || 0}</td>
              <td>
                <div style="display:flex;gap:.35rem;align-items:center;justify-content:flex-end;flex-wrap:wrap">
                  ${badge(s.status)}
                  ${s.status === 'pending_approval' ? `
                    <button class="foreman-action-btn is-success is-compact"
                      data-action="approve-spec" data-id="${s.id}" data-name="${escHtml(s.material_name)}">
                      Согласовать
                    </button>
                    <button class="foreman-action-btn is-danger is-compact"
                      data-action="reject-spec" data-id="${s.id}" data-name="${escHtml(s.material_name)}">
                      Отклонить
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  updateSpecBulkActions();
}

document.getElementById('specs-list').addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('[data-action="approve-spec"]');
  if (approveBtn) {
    if (!confirm(`Согласовать «${approveBtn.dataset.name}»?`)) return;
    const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${approveBtn.dataset.id}/approve`);
    if (ok) { showToast('Позиция согласована', 'success'); loadProjectSpecs(activeProjectId); }
    else showToast(data.error, 'error');
    return;
  }

  const rejectBtn = e.target.closest('[data-action="reject-spec"]');
  if (rejectBtn) {
    rejectSpecMode = 'single';
    activeSpecId = rejectBtn.dataset.id;
    document.getElementById('reject-spec-title').textContent = 'Отклонить позицию';
    document.getElementById('reject-spec-info').textContent = `Материал: ${rejectBtn.dataset.name}`;
    document.getElementById('reject-spec-form').reset();
    openModal('modal-reject-spec');
  }
});

document.getElementById('specs-list').addEventListener('change', (e) => {
  if (e.target.id === 'spec-select-all') {
    getPendingSpecCheckboxes().forEach((input) => {
      input.checked = e.target.checked;
    });
    updateSpecBulkActions();
    return;
  }

  if (e.target.classList.contains('spec-approve-checkbox')) {
    updateSpecBulkActions();
  }
});

document.getElementById('btn-approve-selected-specs').addEventListener('click', async () => {
  const ids = getPendingSpecCheckboxes()
    .filter((input) => input.checked)
    .map((input) => input.value);

  if (!ids.length) {
    showToast('Отметьте хотя бы одну позицию', 'error');
    return;
  }

  const btn = document.getElementById('btn-approve-selected-specs');
  btn.disabled = true;

  for (const id of ids) {
    const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${id}/approve`);
    if (!ok) {
      btn.disabled = false;
      showToast(data.error, 'error');
      return;
    }
  }

  btn.disabled = false;
  showToast('Отмеченные позиции согласованы', 'success');
  getPendingSpecCheckboxes().forEach((input) => { input.checked = false; });
  loadProjectSpecs(activeProjectId);
});

document.getElementById('btn-reject-unchecked-specs').addEventListener('click', () => {
  const unchecked = getPendingSpecCheckboxes().filter((input) => !input.checked);
  if (!unchecked.length) {
    showToast('Нет неотмеченных позиций для отклонения', 'error');
    return;
  }

  rejectSpecMode = 'bulk';
  activeSpecId = null;
  document.getElementById('reject-spec-title').textContent = 'Отклонить неотмеченные позиции';
  document.getElementById('reject-spec-info').textContent = `Будет отклонено позиций: ${unchecked.length}`;
  document.getElementById('reject-spec-form').reset();
  openModal('modal-reject-spec');
});

document.getElementById('reject-spec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rejection_note = new FormData(e.target).get('rejection_note');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  if (rejectSpecMode === 'bulk') {
    const ids = getPendingSpecCheckboxes()
      .filter((input) => !input.checked)
      .map((input) => input.value);

    for (const id of ids) {
      const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${id}/reject`, { rejection_note });
      if (!ok) {
        btn.disabled = false;
        showToast(data.error, 'error');
        return;
      }
    }

    btn.disabled = false;
    closeModal('modal-reject-spec');
    showToast('Неотмеченные позиции отклонены', 'success');
    loadProjectSpecs(activeProjectId);
    return;
  }

  const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${activeSpecId}/reject`, { rejection_note });
  btn.disabled = false;
  if (ok) {
    showToast('Позиция отклонена', 'success');
    closeModal('modal-reject-spec');
    loadProjectSpecs(activeProjectId);
  } else showToast(data.error, 'error');
});

// ─── ВОР: ведомость объёмов работ ────────────────────────────
async function loadWorkSpecs(id) {
  const container = document.getElementById('work-specs-list');
  container.innerHTML = '<div style="color:var(--muted)">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/work-specs`);
  if (!ok) { container.innerHTML = '<div style="color:var(--danger)">Ошибка загрузки</div>'; return; }

  const project = projectsList.find(p => p.id == id);
  const generated = project?.stages_generated;
  const kpSent = Boolean(project?.kp_sent_at);

  const btnGenerate = document.getElementById('btn-generate-stages');
  const btnAdd      = document.getElementById('btn-add-work-spec');

  btnGenerate.style.display = (!generated && data.data.length) ? '' : 'none';
  btnGenerate.disabled = !kpSent;
  btnGenerate.title = kpSent ? '' : 'Сначала менеджер должен отправить КП заказчику';
  btnAdd.style.display      = generated ? 'none' : '';

  const specs = data.data;
  if (!specs.length) {
    container.innerHTML = '<div style="color:var(--muted)">Позиций нет. Добавьте объёмы работ.</div>';
    return;
  }

  const readonly = generated
    ? '<div style="color:var(--muted);font-size:.82rem;margin-bottom:.75rem">ВОР заблокирован — этапы уже сформированы.</div>'
    : !kpSent
      ? '<div style="color:var(--muted);font-size:.82rem;margin-bottom:.75rem">Этапы можно сформировать после отправки КП заказчику.</div>'
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
              <td style="color:var(--muted);font-size:.82rem">${i + 1}</td>
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
    loadWorkSpecs(activeProjectId);
    loadStages(activeProjectId);
  } else showToast(data.error, 'error');
});

document.getElementById('btn-add-work-spec').addEventListener('click', () => {
  const project = projectsList.find(p => p.id == activeProjectId);
  openBatchModal(project?.name || '', 'ВОР', 'Наименование работы', async (items) => {
    const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/work-specs/batch`, { items });
    if (ok) {
      showToast(`Добавлено позиций: ${data.data.inserted}`, 'success');
      closeModal('modal-batch');
      loadWorkSpecs(activeProjectId);
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
    <td style="padding:.3rem .5rem;color:var(--muted);font-size:.8rem;text-align:center">${rowNum}</td>
    <td style="padding:.2rem .3rem">
      <input type="text" class="batch-cell batch-name" placeholder="${isStagesMode ? 'Название этапа' : 'Наименование работы'}"
        style="width:100%;min-width:200px;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
    </td>
    <td class="batch-work-field" style="padding:.2rem .3rem">
      <select class="batch-cell batch-unit"
        style="width:100%;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .4rem;font-size:.84rem;font-family:inherit">
        ${batchUnitOptions()}
      </select>
    </td>
    <td class="batch-work-field" style="padding:.2rem .3rem">
      <input type="number" class="batch-cell batch-qty" placeholder="0" min="0.001" step="any"
        style="width:100%;min-width:80px;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
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
    el.style.display = '';
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

document.getElementById('modal-batch').addEventListener('focusin', e => {
  if (e.target.classList.contains('batch-cell')) e.target.style.borderColor = '#F5A623';
});
document.getElementById('modal-batch').addEventListener('focusout', e => {
  if (e.target.classList.contains('batch-cell')) e.target.style.borderColor = 'var(--border)';
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

// ─── Склад объекта (вкладка проекта) ─────────────────────────
function getProjectWarehouseTable() {
  return document.getElementById(isForemanProjectPage ? 'project-warehouse-table' : 'modal-warehouse-table');
}

async function loadProjectWarehouse(id) {
  const tbody = getProjectWarehouseTable()?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/warehouse`);
  if (!ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--danger)">Ошибка загрузки</td></tr>'; return; }
  if (!data.data.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Склад пуст</td></tr>'; return; }

  tbody.innerHTML = data.data.map(r => `
    <tr>
      <td><strong>${escHtml(r.material_name)}</strong></td>
      <td>${escHtml(r.unit || '—')}</td>
      <td>${r.qty_total}</td>
      <td>${r.qty_used}</td>
      <td style="font-weight:600;color:${Number(r.qty_balance) > 0 ? 'var(--success)' : Number(r.qty_balance) < 0 ? 'var(--danger)' : 'var(--muted)'}">
        ${r.qty_balance}
      </td>
      <td>
        <button class="btn btn-outline btn-sm" style="font-size:.78rem" data-action="writeoff"
          data-id="${r.id}" data-name="${escHtml(r.material_name)}"
          data-unit="${escHtml(r.unit||'')}" data-available="${r.qty_balance}">
          Списать
        </button>
      </td>
    </tr>
  `).join('');
}

getProjectWarehouseTable()?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="writeoff"]');
  if (!btn) return;
  startWarehouseWriteoff(btn, activeProjectId);
});

// ─── Документы (вкладка проекта) ──────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }
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

document.getElementById('writeoff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const quantity = parseFloat(formData.get('quantity'));
  const stage_id = parseInt(formData.get('stage_id'), 10);
  const { ok, data } = await apiRequest('POST', `/api/foreman/warehouse/${activeWarehouseId}/writeoff`, { quantity, stage_id });
  if (ok) {
    showToast('Списание выполнено', 'success');
    closeModal('modal-writeoff');
    // Обновляем активный контекст: или модалку проекта, или секцию склада
    if (document.getElementById('tab-warehouse').style.display !== 'none') {
      loadProjectWarehouse(activeProjectId);
    } else {
      window.foremanDashboardLoadWarehouseAll?.();
    }
  } else showToast(data.error, 'error');
});

function startWarehouseWriteoff(btn, projectId) {
  activeWarehouseId = btn.dataset.id;
  activeWriteoffProjectId = projectId;
  document.getElementById('writeoff-item-info').innerHTML =
    `<strong>${escHtml(btn.dataset.name)}</strong> · Доступно: <strong>${btn.dataset.available} ${escHtml(btn.dataset.unit)}</strong>`;
  document.getElementById('writeoff-form').reset();
  populateWriteoffStages(projectId).then(() => openModal('modal-writeoff'));
}

async function populateWriteoffStages(projectId) {
  const select = document.getElementById('writeoff-stage-select');
  select.innerHTML = '<option value="">— выберите этап —</option>';

  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/stages`);
  if (!ok) return;

  select.innerHTML += data.data.map((stage) =>
    `<option value="${stage.id}">${escHtml(stage.name)}</option>`
  ).join('');
}

function renderStageWriteoffSelect() {
  const select = document.getElementById('stage-writeoff-item-select');
  const hint = document.getElementById('stage-writeoff-hint');

  if (!stageWriteoffItems.length) {
    select.innerHTML = '<option value="">— материалов на складе нет —</option>';
    hint.textContent = 'На складе объекта нет доступных материалов для списания.';
    return;
  }

  select.innerHTML = '<option value="">— выберите материал —</option>' + stageWriteoffItems.map((item) =>
    `<option value="${item.id}">${escHtml(item.material_name)} · доступно ${item.qty_balance} ${escHtml(item.unit || '')}</option>`
  ).join('');
  hint.textContent = 'Списывать можно только материалы с остатком больше 0.';
}

async function loadStageWriteoffHistory(stageId) {
  const list = document.getElementById('stage-writeoff-list');
  list.innerHTML = '<div style="color:var(--muted);font-size:.82rem">Загрузка списаний...</div>';

  const { ok, data } = await apiRequest('GET', `/api/foreman/stages/${stageId}/writeoffs`);
  if (!ok) {
    list.innerHTML = '<div style="color:var(--danger);font-size:.82rem">Не удалось загрузить списания</div>';
    return;
  }

  if (!data.data.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.82rem">На этот этап ещё ничего не списано.</div>';
    return;
  }

  list.innerHTML = data.data.map((row) => `
    <div style="display:flex;justify-content:space-between;gap:.75rem;padding:.45rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:500;font-size:.85rem">${escHtml(row.material_name)}</div>
        <div style="color:var(--muted);font-size:.78rem">${formatDate(row.created_at)}${row.written_off_by_name ? ` · ${escHtml(row.written_off_by_name)}` : ''}</div>
      </div>
      <div style="font-weight:600">${row.quantity} ${escHtml(row.unit || '')}</div>
    </div>
  `).join('');
}

async function loadStageWriteoffPanel(stageId, projectId) {
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/warehouse`);
  stageWriteoffItems = ok
    ? data.data.filter((item) => Number(item.qty_balance) > 0)
    : [];

  document.getElementById('stage-writeoff-qty').value = '';
  renderStageWriteoffSelect();
  await loadStageWriteoffHistory(stageId);
  await loadStagePhotos(stageId);
}

document.getElementById('btn-stage-writeoff-add').addEventListener('click', async () => {
  if (!activeStageId) return;

  const itemId = document.getElementById('stage-writeoff-item-select').value;
  const qty = parseFloat(document.getElementById('stage-writeoff-qty').value);

  if (!itemId || !(qty > 0)) {
    showToast('Выберите материал и количество', 'error');
    return;
  }

  const btn = document.getElementById('btn-stage-writeoff-add');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/foreman/warehouse/${itemId}/writeoff`, {
    quantity: qty,
    stage_id: parseInt(activeStageId, 10),
  });
  btn.disabled = false;

  if (!ok) {
    showToast(data.error, 'error');
    return;
  }

  showToast('Материал списан на этап', 'success');
  await loadStageWriteoffPanel(activeStageId, activeProjectId);
  if (document.getElementById('tab-warehouse').style.display !== 'none') {
    loadProjectWarehouse(activeProjectId);
  }
  loadStages(activeProjectId);
});

async function loadStagePhotos(stageId) {
  const list = document.getElementById('stage-photos-list');
  list.innerHTML = '<div style="color:var(--muted);font-size:.82rem">Загрузка фото...</div>';

  const { ok, data } = await apiRequest('GET', `/api/foreman/stages/${stageId}/photos`);
  if (!ok) {
    list.innerHTML = '<div style="color:var(--danger);font-size:.82rem">Не удалось загрузить фото</div>';
    return;
  }

  if (!data.data.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.82rem">Фото для этапа пока не загружены.</div>';
    return;
  }

  list.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem">
      ${data.data.map((photo) => `
        <div style="position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg2)">
          <button type="button" data-action="delete-stage-photo" data-id="${photo.id}" title="Удалить фото"
            style="position:absolute;top:.4rem;right:.4rem;z-index:2;width:26px;height:26px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(6,10,16,.82);color:#fff;line-height:1;cursor:pointer">×</button>
          <a href="${photo.url}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">
            <img src="${photo.url}" alt="${escHtml(photo.description || 'Фото этапа')}"
              style="width:100%;height:120px;object-fit:cover;display:block">
            <div style="padding:.55rem .6rem">
              <div style="font-size:.75rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(photo.description || 'Без описания')}</div>
              <div style="font-size:.72rem;color:var(--muted);margin-top:.2rem">${formatDate(photo.uploaded_at)}</div>
            </div>
          </a>
        </div>
      `).join('')}
    </div>
  `;
}

document.getElementById('stage-photos-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-stage-photo"]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  if (!confirm('Удалить фото этапа?')) return;

  btn.disabled = true;
  const { ok, data } = await apiRequest('DELETE', `/api/foreman/photos/${btn.dataset.id}`);
  if (!ok) {
    btn.disabled = false;
    showToast(data.error, 'error');
    return;
  }

  showToast('Фото удалено', 'success');
  loadStagePhotos(activeStageId);
});

document.getElementById('stage-photo-inline-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeStageId) return;

  const fd = new FormData(e.target);
  const photo = fd.get('photo');
  if (!(photo instanceof File) || !photo.name) {
    showToast('Выберите фото', 'error');
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Загрузка...';

  const formData = new FormData();
  formData.append('photo', photo);
  if (fd.get('description')) formData.append('description', fd.get('description'));

  const { ok, data } = await apiRequest('POST', `/api/foreman/stages/${activeStageId}/photos`, formData);
  btn.disabled = false;
  btn.textContent = 'Загрузить';

  if (!ok) {
    showToast(data.error, 'error');
    return;
  }

  e.target.reset();
  showToast('Фото загружено', 'success');
  loadStagePhotos(activeStageId);
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
