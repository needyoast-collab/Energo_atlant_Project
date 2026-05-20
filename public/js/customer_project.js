let currentUser = null;
let currentProject = null;
let activeProjectId = null;
let activeTab = 'overview';
let stagesCache = [];
let customerCalendarPlan = null;
let pendingStageId = null;
let pendingDocumentId = null;

const CUSTOMER_DOC_LABELS = window.PROJECT_DOC_LABELS;

async function initCustomerProjectPage() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.CUSTOMER);
    if (!currentUser) return;

    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initNotificationBell();

    const params = new URLSearchParams(window.location.search);
    activeProjectId = params.get('id');
    activeTab = params.get('tab') || 'overview';
    pendingStageId = params.get('stage');
    pendingDocumentId = params.get('doc');

    if (!activeProjectId) {
      renderPageError('Не указан объект');
      return;
    }

    bindCustomerProjectEvents();
    await loadProject();
    await switchProjectTab(activeTab, { replace: true });
  } finally {
    window.hidePreloader?.();
  }
}

function bindCustomerProjectEvents() {
  document.getElementById('btn-back-projects')?.addEventListener('click', () => {
    window.location.href = '/dashboard_customer.html';
  });

  document.getElementById('btn-dashboard-messages')?.addEventListener('click', () => {
    window.location.href = '/dashboard_customer.html?section=messages';
  });

  document.querySelectorAll('[data-project-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchProjectTab(btn.dataset.projectTab));
  });

  document.getElementById('customer-stages-list')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-stage-id]');
    if (!card) return;
    const stage = stagesCache.find((item) => String(item.id) === String(card.dataset.stageId));
    if (stage) openStageDetail(stage);
  });

  document.getElementById('customer-overview')?.addEventListener('click', async (event) => {
    const stageAction = event.target.closest('[data-overview-stage-id]');
    if (stageAction) {
      const stage = stagesCache.find((item) => String(item.id) === String(stageAction.dataset.overviewStageId));
      if (stage) openStageDetail(stage);
      return;
    }

    const tabAction = event.target.closest('[data-overview-tab]');
    if (tabAction) {
      await switchProjectTab(tabAction.dataset.overviewTab);
    }
  });

  document.addEventListener('notification:open', async (event) => {
    const notification = event.detail;
    if (!notification?.project_id) return;

    if (String(notification.project_id) !== String(activeProjectId)) {
      const url = new URL('/customer_project.html', window.location.origin);
      url.searchParams.set('id', notification.project_id);
      url.searchParams.set('tab', notification.type === 'document' ? 'documents' : 'stages');
      if (notification.entity_type === 'stage' && notification.entity_id) {
        url.searchParams.set('stage', notification.entity_id);
      }
      if (notification.entity_type === 'document' && notification.entity_id) {
        url.searchParams.set('doc', notification.entity_id);
      }
      window.location.href = url.toString();
      return;
    }

    if (notification.type === 'document') {
      pendingDocumentId = notification.entity_id ? String(notification.entity_id) : null;
      await switchProjectTab('documents');
      return;
    }

    pendingStageId = notification.entity_id ? String(notification.entity_id) : null;
    await switchProjectTab('stages');
  });
}

async function loadProject() {
  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${activeProjectId}`);
  if (!ok) {
    renderPageError(data?.error || 'Объект не найден');
    return;
  }

  currentProject = data.data;
  document.getElementById('project-title').textContent = currentProject.name;
  document.getElementById('sidebar-project-title').textContent = currentProject.name;

  const status = getCustomerStatus(currentProject.status);
  document.getElementById('project-meta').innerHTML = `
    <span class="badge ${CustomerStatus.getProjectBadgeClass(currentProject.status)}">${escHtml(status)}</span>
    <span>${escHtml(currentProject.code)}</span>
    ${currentProject.address ? `<span>Адрес: ${escHtml(currentProject.address)}</span>` : ''}
    ${currentProject.manager_name ? `<span>Менеджер: ${escHtml(currentProject.manager_name)}</span>` : ''}
    ${currentProject.contract_value ? `<span>Договор: ${formatMoney(currentProject.contract_value)}</span>` : ''}
  `;
}

function renderPageError(message) {
  document.getElementById('customer-project').innerHTML = `
    <section class="foreman-project-shell">
      <div class="foreman-stage-empty">${escHtml(message)}</div>
    </section>
  `;
}

function getCustomerStatus(status) {
  return CustomerStatus.getProjectLabel(status);
}

async function switchProjectTab(tab, options = {}) {
  activeTab = ['overview', 'stages', 'calendar', 'documents', 'warehouse'].includes(tab) ? tab : 'overview';

  document.querySelectorAll('[data-project-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.projectTab === activeTab);
  });

  document.getElementById('tab-overview').classList.toggle('is-hidden', activeTab !== 'overview');
  document.getElementById('tab-stages').classList.toggle('is-hidden', activeTab !== 'stages');
  document.getElementById('tab-calendar').classList.toggle('is-hidden', activeTab !== 'calendar');
  document.getElementById('tab-documents').classList.toggle('is-hidden', activeTab !== 'documents');
  document.getElementById('tab-warehouse').classList.toggle('is-hidden', activeTab !== 'warehouse');

  const url = new URL(window.location.href);
  url.searchParams.set('tab', activeTab);
  if (options.replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);

  if (activeTab === 'documents') {
    await loadDocuments();
    await markProjectDocumentNotificationsRead();
    return;
  }
  if (activeTab === 'warehouse') {
    await loadWarehouse();
    return;
  }
  if (activeTab === 'calendar') {
    await loadCalendarPlan();
    return;
  }
  if (activeTab === 'overview') {
    await loadOverview();
    return;
  }
  await loadStages();
}

async function loadOverview() {
  const container = document.getElementById('customer-overview');
  container.innerHTML = '<div class="foreman-stage-empty">Загрузка обзора...</div>';

  const [stagesRes, docsRes, warehouseRes, notifRes] = await Promise.all([
    apiRequest('GET', `/api/customer/projects/${activeProjectId}/stages`),
    apiRequest('GET', `/api/customer/projects/${activeProjectId}/documents`),
    apiRequest('GET', `/api/customer/projects/${activeProjectId}/warehouse`),
    apiRequest('GET', '/api/notifications'),
  ]);

  if (!stagesRes.ok) {
    container.innerHTML = '<div class="foreman-stage-empty">Не удалось загрузить обзор объекта</div>';
    return;
  }

  const stages = stagesRes.data.data || [];
  const docs = docsRes.ok ? docsRes.data.data || [] : [];
  const warehouseItems = warehouseRes.ok ? warehouseRes.data.data || [] : [];
  const notifications = notifRes.ok
    ? (notifRes.data.data || []).filter((item) => String(item.project_id) === String(activeProjectId))
    : [];

  stagesCache = stages;
  const stats = getStageStats(stages);
  const attentionItems = buildAttentionItems(stages, docs, notifications);
  const nextStage = stages.find((stage) => stage.status !== 'done') || stages[0] || null;
  const latestDocs = docs.slice(0, 3);
  const docsById = new Map(docs.map((doc) => [String(doc.id), doc]));
  const latestEvents = notifications.slice(0, 4).map((event) => getOverviewEvent(event, docsById));
  const warehouseSummary = getWarehouseSummary(warehouseItems);

  container.innerHTML = `
    <div class="customer-overview-layout">
      <section class="customer-overview-panel customer-overview-progress">
        <div class="customer-overview-panel-title">Состояние объекта</div>
        <div class="customer-overview-progress-row">
          <strong>${stats.progress}%</strong>
          <span>${stats.done} из ${stats.total} этапов выполнено</span>
        </div>
        <progress class="foreman-stage-progress-track" value="${stats.progress}" max="100"></progress>
        <div class="customer-overview-metrics">
          <div><span>В работе</span><strong>${stats.inProgress}</strong></div>
          <div><span>Внимание</span><strong>${stats.notDone}</strong></div>
          <div><span>Фото</span><strong>${stats.photos}</strong></div>
        </div>
      </section>

      <div class="customer-overview-stack customer-overview-left-stack">
        <section class="customer-overview-panel customer-overview-attention">
          <div class="customer-overview-panel-title">Требует внимания</div>
          <div class="customer-attention-list">
            ${attentionItems.length ? attentionItems.map(renderAttentionItem).join('') : `
              <div class="customer-attention-empty">Сейчас нет срочных действий по объекту</div>
            `}
          </div>
        </section>

        <section class="customer-overview-panel customer-overview-next">
          <div class="customer-overview-panel-title">Ближайший этап</div>
          ${nextStage ? renderOverviewStage(nextStage) : '<div class="customer-attention-empty">Этапы ещё не добавлены</div>'}
        </section>

        <section class="customer-overview-panel customer-overview-events-panel">
          <div class="customer-overview-panel-title">Последние события</div>
          <div class="customer-overview-events">
            ${latestEvents.length ? latestEvents.map(renderOverviewEvent).join('') : '<div class="customer-attention-empty">Событий пока нет</div>'}
          </div>
        </section>
      </div>

      <div class="customer-overview-stack customer-overview-right-stack">
        <section class="customer-overview-panel customer-overview-documents">
          <div class="customer-overview-panel-title">Последние документы</div>
          <div class="customer-overview-docs">
            ${latestDocs.length ? latestDocs.map(renderOverviewDoc).join('') : '<div class="customer-attention-empty">Документы пока не загружены</div>'}
          </div>
          ${docs.length > 3 ? '<button class="customer-overview-link" type="button" data-overview-tab="documents">Все документы</button>' : ''}
        </section>

        <section class="customer-overview-panel customer-overview-warehouse-panel">
          <div class="customer-overview-panel-title">Склад объекта</div>
          <div class="customer-overview-warehouse">
            <div><span>Позиций</span><strong>${warehouseSummary.count}</strong></div>
            <div><span>Получено</span><strong>${formatNumber(warehouseSummary.total)}</strong></div>
            <div><span>Остаток</span><strong>${formatNumber(warehouseSummary.balance)}</strong></div>
          </div>
          <button class="customer-overview-link" type="button" data-overview-tab="warehouse">Открыть склад</button>
        </section>
      </div>
    </div>
  `;
}

function getStageStats(stages) {
  const total = stages.length;
  const done = stages.filter((stage) => stage.status === 'done').length;
  const inProgress = stages.filter((stage) => stage.status === 'in_progress').length;
  const notDone = stages.filter((stage) =>
    ['attention', 'overdue', 'delayed'].includes(CustomerStatus.getStageKind(stage))
  ).length;
  const photos = stages.reduce((sum, stage) => sum + Number(stage.photo_count || 0), 0);
  return {
    total,
    done,
    inProgress,
    notDone,
    photos,
    progress: total ? Math.round((done / total) * 100) : 0,
  };
}

function buildAttentionItems(stages, docs, notifications) {
  const items = [];
  const approvalStages = stages.filter((stage) => stage.status === 'not_done' && !stage.customer_agreed);
  const unreadDocs = notifications.filter((item) => item.type === 'document' && !item.is_read);

  approvalStages.slice(0, 3).forEach((stage) => {
    items.push({
      type: 'danger',
      title: 'Нужно согласовать этап',
      text: stage.name,
      stageId: stage.id,
    });
  });

  if (unreadDocs.length) {
    items.push({
      type: 'accent',
      title: 'Новые документы',
      text: `${unreadDocs.length} ${getPlural(unreadDocs.length, ['документ', 'документа', 'документов'])} ожидает просмотра`,
      tab: 'documents',
    });
  }

  if (currentProject?.status === 'offer' || currentProject?.status === 'negotiation') {
    items.push({
      type: 'accent',
      title: 'КП на согласовании',
      text: 'Проверьте документы и свяжитесь с менеджером при вопросах',
      tab: 'documents',
    });
  }

  return items;
}

function renderAttentionItem(item) {
  const attrs = [
    item.stageId ? `data-overview-stage-id="${item.stageId}"` : '',
    item.tab ? `data-overview-tab="${item.tab}"` : '',
  ].filter(Boolean).join(' ');
  return `
    <button class="customer-attention-item is-${item.type}" type="button" ${attrs}>
      <span>${escHtml(item.title)}</span>
      <strong>${escHtml(item.text)}</strong>
    </button>
  `;
}

function renderOverviewStage(stage) {
  const statusLabel = getCustomerStageStatusLabel(stage);
  return `
    <button class="customer-overview-stage" type="button" data-overview-stage-id="${stage.id}">
      <div>
        <strong>${escHtml(stage.name)}</strong>
        <span>${formatPlannedPeriod(stage)} · ${escHtml(statusLabel)}</span>
      </div>
      <em>${getStagePercent(stage)}%</em>
    </button>
  `;
}

function renderOverviewDoc(doc) {
  return `
    <a class="customer-overview-doc" href="${doc.url}" target="_blank" rel="noopener">
      <strong>${escHtml(doc.file_name)}</strong>
      <span>${escHtml(doc.doc_label || CUSTOMER_DOC_LABELS[doc.doc_type] || doc.doc_type || 'Документ')} · ${formatDate(doc.uploaded_at)}</span>
    </a>
  `;
}

function renderOverviewEvent(event) {
  return `
    <div class="customer-overview-event">
      <strong>${escHtml(event.message)}</strong>
      <span>${formatDateTime(event.created_at)}</span>
    </div>
  `;
}

function getOverviewEvent(event, docsById) {
  if (event.type !== 'document' || !event.entity_id) return event;

  const doc = docsById.get(String(event.entity_id));
  if (!doc?.file_name) return event;

  return {
    ...event,
    message: `Загружен новый документ: ${doc.file_name}`,
  };
}

function getWarehouseSummary(items) {
  return items.reduce((acc, item) => {
    acc.count += 1;
    acc.total += Number(item.qty_total || 0);
    acc.balance += Number(item.qty_balance || 0);
    return acc;
  }, { count: 0, total: 0, balance: 0 });
}

async function loadCalendarPlan() {
  const container = document.getElementById('customer-calendar-plan');
  const summary = document.getElementById('customer-calendar-summary');
  if (!container) return;

  container.innerHTML = '<div class="foreman-stage-empty">Загрузка календарного плана...</div>';

  try {
    const { ok, data } = await apiRequest('GET', `/api/customer/projects/${activeProjectId}/calendar-plan`);
    if (!ok || !data?.data) {
      throw new Error(data?.error || 'calendar plan request failed');
    }

    customerCalendarPlan = data.data;
    renderCustomerCalendarSummary();
    renderCustomerCalendarPlan();
  } catch (err) {
    console.error('[customer-calendar] failed to load calendar plan', err);
    customerCalendarPlan = null;
    if (summary) summary.textContent = 'Плановые сроки работ по объекту.';
    container.innerHTML = `
      <div class="calendar-plan-empty">
        <strong>Не удалось загрузить календарный план</strong>
        <span>Обновите страницу. Если ошибка повторится, проверьте, что сервер запущен с последней версией кода.</span>
      </div>`;
  }
}

function renderCustomerCalendarSummary() {
  const summary = document.getElementById('customer-calendar-summary');
  if (!summary || !customerCalendarPlan) return;

  const items = customerCalendarPlan.items || [];
  const planned = items.filter((item) => item.planned_start && item.planned_end).length;
  const works = items.filter((item) => !item.is_calendar_mobilization).length;
  summary.textContent = items.length
    ? `${planned} из ${items.length} строк запланированы · работы: ${works} · старт: ${formatDate(customerCalendarPlan.calendar_start)} · горизонт: ${customerCalendarPlan.duration_days} дней.`
    : 'Календарный план ещё не сформирован.';
}

function renderCustomerCalendarPlan() {
  const container = document.getElementById('customer-calendar-plan');
  const items = customerCalendarPlan?.items || [];

  if (!items.length) {
    container.innerHTML = `
      <div class="calendar-plan-empty">
        <strong>Календарный план ещё не сформирован</strong>
        <span>Когда прораб сформирует график, заказчик увидит здесь плановые сроки работ.</span>
      </div>`;
    return;
  }

  const days = Array.from({ length: customerCalendarPlan.duration_days }, (_, i) => i + 1);
  const rows = buildCustomerCalendarRows(items);

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
            const dayInfo = getCustomerCalendarDayInfo(day);
            return `
              <div class="calendar-plan-day-head ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}">
                <div>${day}</div>
                <span>${dayInfo.label}</span>
              </div>`;
          }).join('')}
        </div>
        ${rows.map((row) => `
          <div class="customer-calendar-row">
            ${row.type === 'phase'
              ? renderCustomerCalendarPhaseRow(row, days)
              : renderCustomerCalendarRow(row, days)}
          </div>
        `).join('')}
      </div>
    </div>`;
}

function buildCustomerCalendarRows(items) {
  const rows = [];
  const mobilization = items.filter((item) => item.is_calendar_mobilization);
  const works = items.filter((item) => !item.is_calendar_mobilization);

  rows.push(...mobilization);
  if (works.length) {
    if (mobilization.length) rows.push(createCustomerCalendarPhaseRow('Основные работы', `${works.length} этапов`, works));
    rows.push(...works);
  }

  return rows;
}

function createCustomerCalendarPhaseRow(name, subtitle, items) {
  const planned = items.filter((item) => item.planned_start && item.planned_end);
  const starts = planned.map((item) => item.planned_start).sort();
  const ends = planned.map((item) => item.planned_end).sort();

  return {
    type: 'phase',
    name,
    subtitle,
    planned_start: starts[0] || null,
    planned_end: ends[ends.length - 1] || null,
    is_overdue: items.some(isCustomerCalendarItemOverdue),
  };
}

function renderCustomerCalendarPhaseRow(row, days) {
  const rangeText = row.planned_start && row.planned_end
    ? `${formatDate(row.planned_start)} — ${formatDate(row.planned_end)}`
    : 'Диапазон не задан';

  return `
    <div class="calendar-plan-left calendar-plan-sticky-left calendar-phase-left ${row.is_overdue ? 'is-overdue' : ''}">
      <div class="calendar-phase-title">${escHtml(row.name)}</div>
      <div class="calendar-phase-meta">${escHtml(row.subtitle)} · ${rangeText}</div>
    </div>
    ${days.map((day) => {
      const dayInfo = getCustomerCalendarDayInfo(day);
      return `<div class="calendar-cell calendar-phase-cell customer-calendar-cell ${row.is_overdue ? 'is-overdue' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}"></div>`;
    }).join('')}`;
}

function renderCustomerCalendarRow(item, days) {
  const range = getCustomerCalendarItemRange(item);
  const actual = getCustomerCalendarItemActualEnd(item);
  const progress = getCustomerCalendarItemProgress(item);
  const delayDays = getCustomerCalendarItemDelayDays(item);
  const isDelayed = delayDays > 0;
  const isActiveOverdue = isCustomerCalendarItemActiveOverdue(item);
  const hasDeadlineIssue = isDelayed || isActiveOverdue;
  const isMobilization = item.is_calendar_mobilization;
  const dates = item.planned_start && item.planned_end
    ? `${formatDate(item.planned_start)} — ${formatDate(item.planned_end)}`
    : 'Диапазон не задан';
  const statusLabel = hasDeadlineIssue
    ? isDelayed ? `Просрочка +${delayDays} дн.` : 'Просрочено'
    : getCustomerStageStatusLabel(item);
  const actualDay = actual ? customerCalendarDayIndex(actual) : null;
  const delayEndDay = actualDay ? Math.min(customerCalendarPlan.duration_days, actualDay) : null;

  return `
    <div class="calendar-plan-left calendar-plan-sticky-left ${isMobilization ? 'is-mobilization' : ''} ${hasDeadlineIssue ? 'is-overdue' : ''}">
      <div class="calendar-stage-row-main">
        <div class="calendar-stage-text">
          <div class="calendar-stage-name ${isMobilization ? 'calendar-stage-name-fixed' : ''}">${escHtml(item.name)}</div>
          <div class="calendar-stage-meta">${dates}${actual ? ` · факт: ${formatDate(actual)}` : ''}${isDelayed ? ` · +${delayDays} дн.` : ''}</div>
        </div>
        <div class="calendar-stage-badges">
          <span class="calendar-stage-progress ${hasDeadlineIssue ? 'is-danger' : ''}">${progress}%</span>
          <span class="calendar-stage-status ${getCustomerCalendarStatusClass(item, hasDeadlineIssue)}">${escHtml(statusLabel)}</span>
        </div>
      </div>
    </div>
    ${days.map((day) => {
      const dayInfo = getCustomerCalendarDayInfo(day);
      const selected = range && day >= range.start && day <= range.end;
      const isStart = selected && day === range.start;
      const isEnd = selected && day === range.end;
      const isDelayTail = isDelayed && range && delayEndDay && day > range.end && day <= delayEndDay;
      const isDelayStart = isDelayTail && day === range.end + 1;
      const isDelayEnd = isDelayTail && day === delayEndDay;
      return `
        <div class="calendar-cell customer-calendar-cell ${selected ? 'selected' : ''} ${isStart ? 'range-start' : ''} ${isEnd ? 'range-end' : ''} ${hasDeadlineIssue ? 'is-overdue' : ''} ${isDelayTail ? 'delay-tail' : ''} ${isDelayStart ? 'delay-start' : ''} ${isDelayEnd ? 'delay-end' : ''} ${isMobilization ? 'mobilization' : ''} ${day % 7 === 1 ? 'week-start' : ''} ${dayInfo.isWeekend ? 'is-weekend' : ''} ${dayInfo.isToday ? 'is-today' : ''}"
             title="${escHtml(item.name)} · ${formatDate(dayInfo.dateOnly)}">
          <span></span>
        </div>`;
    }).join('')}`;
}

function addCustomerCalendarDays(dateOnly, days) {
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

function getCustomerCalendarDayInfo(day) {
  const dateOnly = addCustomerCalendarDays(customerCalendarPlan.calendar_start, day - 1);
  const [year, month, date] = dateOnly.split('-').map(Number);
  const weekDay = new Date(year, month - 1, date).getDay();
  return {
    dateOnly,
    label: `${String(date).padStart(2, '0')}.${String(month).padStart(2, '0')}`,
    isWeekend: weekDay === 0 || weekDay === 6,
    isToday: dateOnly === getLocalDateOnly(),
  };
}

function customerCalendarDayIndex(dateOnly) {
  if (!customerCalendarPlan?.calendar_start || !dateOnly) return null;
  const [fromYear, fromMonth, fromDay] = String(customerCalendarPlan.calendar_start).slice(0, 10).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(dateOnly).slice(0, 10).split('-').map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86400000) + 1;
}

function customerCalendarDateDiffDays(fromDateOnly, toDateOnly) {
  if (!fromDateOnly || !toDateOnly) return 0;
  const [fromYear, fromMonth, fromDay] = String(fromDateOnly).slice(0, 10).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(toDateOnly).slice(0, 10).split('-').map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86400000);
}

function getCustomerCalendarItemRange(item) {
  const start = customerCalendarDayIndex(item.planned_start);
  const end = customerCalendarDayIndex(item.planned_end);
  if (!start || !end) return null;
  if (end < 1 || start > customerCalendarPlan.duration_days) return null;
  return {
    start: Math.max(1, Math.min(start, end)),
    end: Math.min(customerCalendarPlan.duration_days, Math.max(start, end)),
  };
}

function getCustomerCalendarItemProgress(item) {
  if (item.planned_value) {
    return Math.min(100, Math.round((Number(item.actual_value || 0) / Number(item.planned_value)) * 100));
  }
  return item.status === 'done' ? 100 : 0;
}

function isCustomerCalendarItemDone(item) {
  return item.status === 'done' || getCustomerCalendarItemProgress(item) >= 100;
}

function getCustomerCalendarItemActualEnd(item) {
  return item.actual_date || item.actual_end || null;
}

function getCustomerCalendarItemDelayDays(item) {
  const actualEnd = getCustomerCalendarItemActualEnd(item);
  if (!item.planned_end || !actualEnd) return 0;
  return Math.max(0, customerCalendarDateDiffDays(item.planned_end, actualEnd));
}

function isCustomerCalendarItemActiveOverdue(item) {
  if (!item.planned_end || isCustomerCalendarItemDone(item)) return false;
  return String(item.planned_end).slice(0, 10) < getLocalDateOnly();
}

function isCustomerCalendarItemOverdue(item) {
  return isCustomerCalendarItemActiveOverdue(item) || getCustomerCalendarItemDelayDays(item) > 0;
}

function getCustomerCalendarStatusClass(item, hasDeadlineIssue) {
  if (hasDeadlineIssue) return 'is-danger';
  return CustomerStatus.getStagePanelClass(item);
}

async function loadStages() {
  const container = document.getElementById('customer-stages-list');
  container.innerHTML = '<div class="foreman-stage-empty">Загрузка этапов...</div>';

  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${activeProjectId}/stages`);
  if (!ok) {
    container.innerHTML = '<div class="foreman-stage-empty">Не удалось загрузить ход работ</div>';
    return;
  }

  stagesCache = data.data || [];
  if (!stagesCache.length) {
    container.innerHTML = '<div class="foreman-stage-empty">Этапы ещё не добавлены</div>';
    return;
  }

  const total = stagesCache.length;
  const done = stagesCache.filter((stage) => stage.status === 'done').length;
  const notDone = stagesCache.filter((stage) =>
    ['attention', 'overdue', 'delayed'].includes(CustomerStatus.getStageKind(stage))
  ).length;
  const inProgress = stagesCache.filter((stage) => stage.status === 'in_progress').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  container.innerHTML = `
    <div class="foreman-stage-overview customer-stage-overview">
      <div class="foreman-stage-progress-card">
        <div>
          <span>Готовность по этапам</span>
          <strong>${pct}%</strong>
        </div>
        <progress class="foreman-stage-progress-track" value="${pct}" max="100"></progress>
      </div>
      <div class="foreman-stage-stats">
        <div><span>Всего</span><strong>${total}</strong></div>
        <div><span>Выполнено</span><strong>${done}</strong></div>
        <div><span>В работе</span><strong>${inProgress}</strong></div>
        <div><span>Внимание</span><strong>${notDone}</strong></div>
      </div>
    </div>
    <div class="customer-stage-list">
      ${stagesCache.map(renderStageCard).join('')}
    </div>
  `;

  if (pendingStageId) {
    const stage = stagesCache.find((item) => String(item.id) === String(pendingStageId));
    pendingStageId = null;
    if (stage) openStageDetail(stage);
  }
}

function renderStageCard(stage) {
  const pct = getStagePercent(stage);
  const statusLabel = getCustomerStageStatusLabel(stage);
  const statusClass = getStageStatusClass(stage);
  const needsApproval = stage.status === 'not_done' && !stage.customer_agreed;

  return `
    <article class="foreman-stage-card customer-stage-card ${needsApproval ? 'needs-approval' : ''}"
             role="button" tabindex="0" data-stage-id="${stage.id}">
      <div class="foreman-stage-main">
        <span class="foreman-stage-order">${stage.order_num ?? 0}</span>
        <div class="foreman-stage-text">
          <div class="foreman-stage-name">${escHtml(stage.name)}</div>
          <div class="foreman-stage-subline">${formatStageSubline(stage)}</div>
        </div>
      </div>
      <div class="foreman-stage-meta-grid">
        <div>
          <span>Плановые сроки</span>
          <strong>${formatPlannedPeriod(stage)}</strong>
        </div>
        <div>
          <span>Фактическое окончание</span>
          <strong>${formatActualDate(stage)}</strong>
        </div>
        <div class="wide">
          <span>Примечание</span>
          <strong>${escHtml(stage.note || '—')}</strong>
        </div>
      </div>
      <div class="foreman-stage-status ${statusClass}">${escHtml(statusLabel)}</div>
      <div class="foreman-stage-progress-row">
        <progress class="foreman-stage-progress-track" value="${pct}" max="100"></progress>
        <strong>${pct}%</strong>
      </div>
    </article>
  `;
}

function getStagePercent(stage) {
  if (stage.status === 'done') return 100;
  if (stage.is_from_vor && Number(stage.planned_value) > 0) {
    return Math.min(100, Math.round((Number(stage.actual_value || 0) / Number(stage.planned_value)) * 100));
  }
  return 0;
}

function getStageStatusClass(stage) {
  return CustomerStatus.getStagePanelClass(stage);
}

function getCustomerStageStatusLabel(stage) {
  return CustomerStatus.getStageLabel(stage);
}

function isStageActiveOverdue(stage) {
  return CustomerStatus.isStageActiveOverdue(stage);
}

function formatStageSubline(stage) {
  const parts = [];
  if (stage.is_from_vor && Number(stage.planned_value) > 0) {
    parts.push(`${formatNumber(stage.actual_value || 0)} / ${formatNumber(stage.planned_value)} ${escHtml(stage.unit || '')}`.trim());
  }
  if (Number(stage.photo_count) > 0) parts.push(`${stage.photo_count} фото`);
  return parts.length ? parts.join(' · ') : 'Подробности этапа';
}

function formatPlannedPeriod(stage) {
  if (stage.planned_start && stage.planned_end) {
    return `${formatDate(stage.planned_start)} — ${formatDate(stage.planned_end)}`;
  }
  if (stage.planned_start) return formatDate(stage.planned_start);
  if (stage.planned_date) return formatDate(stage.planned_date);
  return '—';
}

function formatActualDate(stage) {
  return formatDate(stage.actual_end || stage.actual_date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function getPlural(value, forms) {
  const number = Math.abs(Number(value)) % 100;
  const last = number % 10;
  if (number > 10 && number < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

function openStageDetail(stage) {
  const needsApproval = stage.status === 'not_done' && !stage.customer_agreed;
  const approvedNotDone = stage.status === 'not_done' && stage.customer_agreed;

  document.getElementById('stage-detail-body').innerHTML = `
    <div class="customer-stage-detail-head">
      <div>
        <div class="customer-stage-detail-project">${escHtml(currentProject?.name || 'Объект')}</div>
        <div class="customer-stage-detail-title">${escHtml(stage.name)}</div>
      </div>
      <div class="foreman-stage-status ${getStageStatusClass(stage)}">
        ${escHtml(getCustomerStageStatusLabel(stage))}
      </div>
    </div>
    <div class="customer-stage-detail-grid">
      ${detailCell('Плановые сроки', formatPlannedPeriod(stage))}
      ${detailCell('Фактическое окончание', formatActualDate(stage))}
      ${detailCell('Готовность', `${getStagePercent(stage)}%`)}
      ${stage.is_from_vor ? detailCell('Объём', `${formatNumber(stage.actual_value || 0)} / ${formatNumber(stage.planned_value || 0)} ${escHtml(stage.unit || '')}`.trim()) : ''}
    </div>
    ${stage.note ? `
      <div class="customer-stage-note ${needsApproval ? 'is-danger' : ''}">
        <span>Примечание</span>
        <strong>${escHtml(stage.note)}</strong>
      </div>` : ''}
    ${needsApproval ? `
      <div class="customer-stage-approval">
        <div>
          <strong>Требуется согласование</strong>
          <span>Подтвердите, что ознакомлены с причиной невыполнения этапа.</span>
        </div>
        <button class="foreman-action-btn is-danger is-compact" id="btn-approve-stage">Согласовать</button>
      </div>` : ''}
    ${approvedNotDone ? '<div class="customer-stage-approved">Вы согласовали этот этап</div>' : ''}
    ${Number(stage.photo_count) > 0 ? `
      <div class="customer-stage-photos">
        <div class="customer-stage-block-title">Фото этапа</div>
        <div id="stage-photos-grid" class="customer-stage-photos-grid">
          <span class="text-muted">Загрузка...</span>
        </div>
      </div>` : ''}
  `;

  openModal('modal-stage-detail');

  document.getElementById('btn-approve-stage')?.addEventListener('click', () => approveStage(stage.id));
  if (Number(stage.photo_count) > 0) loadStagePhotos(stage.id);
}

function detailCell(label, value) {
  return `
    <div class="customer-stage-detail-cell">
      <span>${escHtml(label)}</span>
      <strong>${value || '—'}</strong>
    </div>
  `;
}

async function approveStage(stageId) {
  const button = document.getElementById('btn-approve-stage');
  if (button) button.disabled = true;

  const { ok, data } = await apiRequest(
    'PUT',
    `/api/customer/projects/${activeProjectId}/stages/${stageId}/approve`
  );

  if (button) button.disabled = false;
  if (!ok) {
    showToast(data?.error || 'Не удалось согласовать этап', 'error');
    return;
  }

  showToast('Этап согласован', 'success');
  closeModal('modal-stage-detail');
  if (activeTab === 'overview') await loadOverview();
  else await loadStages();
}

async function loadStagePhotos(stageId) {
  const grid = document.getElementById('stage-photos-grid');
  if (!grid) return;

  const { ok, data } = await apiRequest('GET', `/api/customer/stages/${stageId}/photos`);
  if (!ok || !data.data?.length) {
    grid.innerHTML = '<span class="text-muted">Фото пока нет</span>';
    return;
  }

  grid.innerHTML = data.data.map((photo) => `
    <a href="${photo.url}" target="_blank" rel="noopener" class="stage-photo-thumb">
      <img src="${photo.url}" alt="${escHtml(photo.description || '')}">
    </a>
  `).join('');
}

async function loadDocuments() {
  const container = document.getElementById('customer-documents-list');
  container.innerHTML = '<div class="foreman-stage-empty">Загрузка документов...</div>';

  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${activeProjectId}/documents`);
  if (!ok) {
    container.innerHTML = '<div class="foreman-stage-empty">Не удалось загрузить документы</div>';
    return;
  }

  const docs = data.data || [];
  if (!docs.length) {
    container.innerHTML = '<div class="foreman-stage-empty">Документы пока не загружены</div>';
    return;
  }

  container.innerHTML = `
    <div class="customer-doc-list">
      ${docs.map(renderDocumentCard).join('')}
    </div>
  `;

  if (pendingDocumentId) {
    const target = container.querySelector(`[data-doc-id="${pendingDocumentId}"]`);
    pendingDocumentId = null;
    if (target) {
      target.classList.add('entity-highlight');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

function renderDocumentCard(doc) {
  const ext = String(doc.file_name || '').split('.').pop().slice(0, 4).toUpperCase() || 'DOC';
  return `
    <article class="customer-doc-card" data-doc-id="${doc.id}">
      <div class="customer-doc-ext">${escHtml(ext)}</div>
      <div class="customer-doc-main">
        <div class="customer-doc-title">${escHtml(doc.file_name)}</div>
        <div class="customer-doc-meta">
          ${escHtml(doc.doc_label || CUSTOMER_DOC_LABELS[doc.doc_type] || doc.doc_type || 'Документ')}
          ${doc.description ? ` · ${escHtml(doc.description)}` : ''}
        </div>
        <div class="customer-doc-meta">${formatDate(doc.uploaded_at)} · ${escHtml(doc.uploaded_by_name || 'ЭнергоАтлант')}</div>
      </div>
      <a href="${doc.url}" target="_blank" rel="noopener" class="foreman-action-btn is-secondary is-compact">Скачать</a>
    </article>
  `;
}

async function loadWarehouse() {
  const container = document.getElementById('customer-warehouse-list');
  container.innerHTML = '<div class="foreman-stage-empty">Загрузка склада...</div>';

  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${activeProjectId}/warehouse`);
  if (!ok) {
    container.innerHTML = '<div class="foreman-stage-empty">Не удалось загрузить склад объекта</div>';
    return;
  }

  const items = data.data || [];
  if (!items.length) {
    container.innerHTML = '<div class="foreman-stage-empty">Материалы на склад объекта пока не поступали</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Материал</th>
            <th>Ед.</th>
            <th>Получено</th>
            <th>Использовано</th>
            <th>Остаток</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const balance = Number(item.qty_balance || 0);
            const balanceClass = balance > 0 ? 'text-success' : balance < 0 ? 'text-danger' : 'text-muted';
            return `
              <tr>
                <td>${escHtml(item.material_name)}</td>
                <td>${escHtml(item.unit || '—')}</td>
                <td>${formatNumber(item.qty_total)}</td>
                <td>${formatNumber(item.qty_used)}</td>
                <td class="customer-warehouse-balance ${balanceClass}">${formatNumber(item.qty_balance)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function markProjectDocumentNotificationsRead() {
  const { ok, data } = await apiRequest('GET', '/api/notifications');
  if (!ok) return;

  const unreadDocNotifications = (data.data || []).filter((item) =>
    item.type === 'document'
    && !item.is_read
    && String(item.project_id) === String(activeProjectId)
  );

  await Promise.all(unreadDocNotifications.map((item) => apiRequest('PUT', `/api/notifications/${item.id}/read`)));
}

initCustomerProjectPage();
