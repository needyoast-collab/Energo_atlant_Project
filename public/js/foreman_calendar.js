// ─── Календарный план прораба ────────────────────────────────
(function () {
  const DEFAULT_STATUS_LABELS = {
    pending: 'Запланировано',
    planned: 'Запланировано',
    in_progress: 'В работе',
    done: 'Выполнено',
    not_done: 'Не выполнено',
  };

  let calendarPlan = null;
  let calendarRangeDraft = null;
  const calendarGridClassCache = new Set();
  const state = {
    getActiveProjectId: () => null,
    statusLabels: DEFAULT_STATUS_LABELS,
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function getStatusLabel(status) {
    return state.statusLabels?.[status] || status || '—';
  }

  function ensureCalendarGridClass(daysCount) {
    const safeDays = Math.max(1, Math.min(730, Number(daysCount) || 1));
    const className = `calendar-plan-grid-days-${safeDays}`;
    if (calendarGridClassCache.has(className)) return className;

    const minWidth = 440 + safeDays * 32;
    const rule =
      `.calendar-plan-grid.${className}{` +
      `grid-template-columns:440px repeat(${safeDays},32px);` +
      `min-width:${minWidth}px;` +
      `}`;

    const sheets = Array.from(document.styleSheets || []);
    for (const sheet of sheets) {
      try {
        sheet.insertRule(rule, sheet.cssRules.length);
        calendarGridClassCache.add(className);
        return className;
      } catch (error) {
        // Keep trying other same-origin stylesheets.
      }
    }

    calendarGridClassCache.add(className);
    return className;
  }

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

  async function load(projectId = getActiveProjectId()) {
    if (!projectId) return;
    calendarRangeDraft = null;
    const container = document.getElementById('calendar-plan-list');
    if (!container) return;
    container.innerHTML = '<span class="text-muted">Загрузка...</span>';
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/calendar-plan`);
    if (!ok) {
      container.innerHTML = '<span class="text-danger">Ошибка загрузки календарного плана</span>';
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
    generateBtn.classList.toggle('is-hidden', hasMobilization);
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

    const gridClass = ensureCalendarGridClass(days.length);
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
        <div class="calendar-plan-grid ${gridClass}">
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
    const statusLabel = getStatusLabel(item.status);
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
            <span></span>
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
    await load(getActiveProjectId());
  }

  async function handlePlanClick(event) {
    const cell = event.target.closest('.calendar-cell');
    if (!cell) return;
    if (!cell.dataset.id || !cell.dataset.day) return;
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
  }

  async function generatePlan() {
    const projectId = getActiveProjectId();
    if (!projectId) return;
    const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${projectId}/calendar-plan/generate`);
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
  }

  function exportPlan() {
    if (!calendarPlan?.items?.length) {
      showToast('Сначала сформируйте календарный план', 'error');
      return;
    }
    window.open(`/api/foreman/projects/${getActiveProjectId()}/calendar-plan/export`, '_blank');
  }

  function init() {
    document.getElementById('calendar-plan-list')?.addEventListener('click', handlePlanClick);
    document.getElementById('btn-generate-calendar-plan')?.addEventListener('click', generatePlan);
    document.getElementById('btn-export-calendar-plan')?.addEventListener('click', exportPlan);
  }

  window.ForemanCalendar = {
    configure,
    init,
    load,
  };
})();
