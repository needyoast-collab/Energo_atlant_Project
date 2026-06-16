(function () {
  'use strict';

  let calendarPlan = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function addDays(dateOnly, days) {
    const [year, month, day] = String(dateOnly).slice(0, 10).split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function localDateOnly() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayIndex(dateOnly) {
    if (!calendarPlan?.calendar_start || !dateOnly) return null;
    const [fy, fm, fd] = String(calendarPlan.calendar_start).slice(0, 10).split('-').map(Number);
    const [ty, tm, td] = String(dateOnly).slice(0, 10).split('-').map(Number);
    return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000) + 1;
  }

  function dayInfo(day) {
    const dateOnly = addDays(calendarPlan.calendar_start, day - 1);
    const [y, m, d] = dateOnly.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    return {
      dateOnly,
      label: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`,
      isWeekend: wd === 0 || wd === 6,
      isToday: dateOnly === localDateOnly(),
    };
  }

  function itemRange(item) {
    const start = dayIndex(item.planned_start);
    const end   = dayIndex(item.planned_end);
    if (start == null || end == null) return null;
    if (end < 1 || start > calendarPlan.duration_days) return null;
    return {
      start: Math.max(1, start),
      end:   Math.min(calendarPlan.duration_days, Math.max(start, end)),
    };
  }

  function itemProgress(item) {
    if (item.status === 'done') return 100;
    const v = Number(item.actual_value);
    const p = Number(item.planned_value);
    if (p > 0) return Math.min(100, Math.round((v / p) * 100));
    return 0;
  }

  function delayDays(item) {
    if (!item.planned_end || item.status === 'done') return 0;
    const today = localDateOnly();
    if (today <= item.planned_end) return 0;
    const [py, pm, pd] = item.planned_end.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    return Math.round((new Date(ty, tm - 1, td) - new Date(py, pm - 1, pd)) / 86400000);
  }

  function statusLabel(item, hasDeadlineIssue, delay) {
    if (hasDeadlineIssue) return delay > 0 ? `Просрочка +${delay} дн.` : 'Просрочено';
    const MAP = { pending: 'Запланировано', in_progress: 'В работе', done: 'Выполнено', planned: 'Запланировано', not_done: 'Не выполнено' };
    return MAP[item.status] || item.status;
  }

  function statusClass(item, hasDeadlineIssue) {
    if (hasDeadlineIssue) return 'stage-status-danger';
    if (item.status === 'done') return 'stage-status-done';
    if (item.status === 'in_progress') return 'stage-status-active';
    return 'stage-status-pending';
  }

  // ── render ────────────────────────────────────────────────────────────────

  function renderSummary() {
    const el = document.getElementById('manager-calendar-summary');
    if (!el || !calendarPlan) return;
    const items   = calendarPlan.items || [];
    const planned = items.filter((i) => i.planned_start && i.planned_end).length;
    const works   = items.filter((i) => !i.is_calendar_mobilization).length;
    el.textContent = items.length
      ? `${planned} из ${items.length} строк запланированы · работы: ${works} · старт: ${formatDate(calendarPlan.calendar_start)} · горизонт: ${calendarPlan.duration_days} дней.`
      : 'Календарный план ещё не сформирован.';
  }

  function buildRows(items) {
    const mob   = items.filter((i) => i.is_calendar_mobilization);
    const works = items.filter((i) => !i.is_calendar_mobilization);
    const rows  = [...mob];
    if (works.length) {
      if (mob.length) {
        const planned = works.filter((i) => i.planned_start && i.planned_end);
        const starts  = planned.map((i) => i.planned_start).sort();
        const ends    = planned.map((i) => i.planned_end).sort();
        rows.push({
          type: 'phase',
          name: 'Основные работы',
          subtitle: `${works.length} этапов`,
          planned_start: starts[0] || null,
          planned_end:   ends[ends.length - 1] || null,
          is_overdue:    works.some((i) => delayDays(i) > 0),
        });
      }
      rows.push(...works);
    }
    return rows;
  }

  function renderPhaseRow(row, days) {
    const range = row.planned_start && row.planned_end
      ? `${formatDate(row.planned_start)} — ${formatDate(row.planned_end)}`
      : 'Диапазон не задан';
    return `
      <div class="calendar-plan-left calendar-plan-sticky-left calendar-phase-left ${row.is_overdue ? 'is-overdue' : ''}">
        <div class="calendar-phase-title">${escHtml(row.name)}</div>
        <div class="calendar-phase-meta">${escHtml(row.subtitle)} · ${range}</div>
      </div>
      ${days.map((day) => {
        const di = dayInfo(day);
        return `<div class="calendar-cell calendar-phase-cell customer-calendar-cell ${row.is_overdue ? 'is-overdue' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${di.isWeekend ? 'is-weekend' : ''} ${di.isToday ? 'is-today' : ''}"></div>`;
      }).join('')}`;
  }

  function renderItemRow(item, days) {
    const range     = itemRange(item);
    const progress  = itemProgress(item);
    const delay     = delayDays(item);
    const hasIssue  = delay > 0 || (!item.actual_end && item.planned_end && localDateOnly() > item.planned_end && item.status !== 'done');
    const isMob     = item.is_calendar_mobilization;
    const dates     = item.planned_start && item.planned_end
      ? `${formatDate(item.planned_start)} — ${formatDate(item.planned_end)}`
      : 'Диапазон не задан';
    const actualDay    = item.actual_end ? dayIndex(item.actual_end) : null;
    const delayEndDay  = actualDay ? Math.min(calendarPlan.duration_days, actualDay) : null;

    return `
      <div class="calendar-plan-left calendar-plan-sticky-left ${isMob ? 'is-mobilization' : ''} ${hasIssue ? 'is-overdue' : ''}">
        <div class="calendar-stage-row-main">
          <div class="calendar-stage-text">
            <div class="calendar-stage-name ${isMob ? 'calendar-stage-name-fixed' : ''}">${escHtml(item.name)}</div>
            <div class="calendar-stage-meta">${dates}${item.actual_end ? ` · факт: ${formatDate(item.actual_end)}` : ''}${delay > 0 ? ` · +${delay} дн.` : ''}</div>
          </div>
          <div class="calendar-stage-badges">
            <span class="calendar-stage-progress ${hasIssue ? 'is-danger' : ''}">${progress}%</span>
            <span class="calendar-stage-status ${statusClass(item, hasIssue)}">${escHtml(statusLabel(item, hasIssue, delay))}</span>
          </div>
        </div>
      </div>
      ${days.map((day) => {
        const di       = dayInfo(day);
        const sel      = range && day >= range.start && day <= range.end;
        const isStart  = sel && day === range.start;
        const isEnd    = sel && day === range.end;
        const isTail   = delay > 0 && range && delayEndDay && day > range.end && day <= delayEndDay;
        return `
          <div class="calendar-cell customer-calendar-cell ${sel ? 'selected' : ''} ${isStart ? 'range-start' : ''} ${isEnd ? 'range-end' : ''} ${hasIssue ? 'is-overdue' : ''} ${isTail ? 'delay-tail' : ''} ${isMob ? 'mobilization' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${di.isWeekend ? 'is-weekend' : ''} ${di.isToday ? 'is-today' : ''}"
               title="${escHtml(item.name)} · ${formatDate(di.dateOnly)}">
            <span></span>
          </div>`;
      }).join('')}`;
  }

  function render() {
    const container = document.getElementById('manager-calendar-plan');
    if (!container) return;

    const items = calendarPlan?.items || [];
    if (!items.length) {
      container.innerHTML = `
        <div class="calendar-plan-empty">
          <strong>Календарный план ещё не сформирован</strong>
          <span>Прораб сформирует план на вкладке «Календарный план» своей страницы проекта.</span>
        </div>`;
      return;
    }

    const days = Array.from({ length: calendarPlan.duration_days }, (_, i) => i + 1);
    const rows = buildRows(items);

    container.innerHTML = `
      <div class="calendar-plan-toolbar customer-calendar-toolbar">
        <div class="calendar-plan-legend">
          <span><i class="calendar-legend-work"></i>Работы</span>
          <span><i class="calendar-legend-mobilization"></i>Мобилизация</span>
          <span><i class="calendar-legend-overdue"></i>Просрочка</span>
          <span><i class="calendar-legend-today"></i>Сегодня</span>
        </div>
        <div class="calendar-plan-hint">График доступен только для просмотра.</div>
      </div>
      <div class="calendar-plan-shell customer-calendar-shell">
        <div class="calendar-plan-grid customer-calendar-plan-grid">
          <div class="customer-calendar-row customer-calendar-header-row">
            <div class="calendar-plan-head calendar-plan-sticky-left">Работы</div>
            ${days.map((day) => {
              const di = dayInfo(day);
              return `
                <div class="calendar-plan-day-head ${day % 7 === 1 ? 'week-start' : ''} ${di.isWeekend ? 'is-weekend' : ''} ${di.isToday ? 'is-today' : ''}">
                  <div>${day}</div><span>${di.label}</span>
                </div>`;
            }).join('')}
          </div>
          ${rows.map((row) => `
            <div class="customer-calendar-row">
              ${row.type === 'phase' ? renderPhaseRow(row, days) : renderItemRow(row, days)}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // ── public API ────────────────────────────────────────────────────────────

  async function load(projectId) {
    const container = document.getElementById('manager-calendar-plan');
    const summary   = document.getElementById('manager-calendar-summary');
    if (!container) return;

    container.innerHTML = '<div class="foreman-stage-empty">Загрузка календарного плана...</div>';

    try {
      const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/calendar-plan`);
      if (!ok || !data?.data) throw new Error(data?.error || 'calendar plan failed');
      calendarPlan = data.data;
      renderSummary();
      render();
    } catch (err) {
      calendarPlan = null;
      if (summary) summary.textContent = 'Плановые сроки работ по объекту.';
      container.innerHTML = `
        <div class="calendar-plan-empty">
          <strong>Не удалось загрузить календарный план</strong>
          <span>Обновите страницу. Если ошибка повторится, проверьте, что сервер запущен с последней версией кода.</span>
        </div>`;
    }
  }

  window.ManagerCalendar = { load };
}());
