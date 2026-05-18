let currentUser = null;
let currentProject = null;
let activeProjectId = null;
let activeTab = 'overview';
let stagesCache = [];
let pendingStageId = null;
let pendingDocumentId = null;

const CUSTOMER_STATUS_LABELS = {
  lead: 'Рассматривается',
  qualification: 'Рассматривается',
  visit: 'Рассматривается',
  offer: 'Согласование',
  negotiation: 'Согласование',
  contract: 'Договор подписан',
  work: 'В работе',
  won: 'Завершён',
  lost: 'Отменён',
};

const CUSTOMER_STATUS_CLASSES = {
  'Рассматривается': 'badge-gray',
  'Согласование': 'badge-yellow',
  'Договор подписан': 'badge-blue',
  'В работе': 'badge-green',
  'Завершён': 'badge-gray',
  'Отменён': 'badge-red',
};

const CUSTOMER_DOC_LABELS = {
  hidden_works_act: 'Акт скрытых работ',
  exec_scheme: 'Исполнительная схема',
  geodetic_survey: 'Геодезическая съёмка',
  general_works_log: 'Общий журнал работ',
  author_supervision: 'Журнал авторского надзора',
  interim_acceptance: 'Акт промежуточной приёмки',
  cable_test_act: 'Акт испытания КЛ',
  measurement_protocol: 'Протокол измерений',
  rd: 'Рабочая документация (РД)',
  pd: 'Проектная документация (ПД)',
  tz: 'Техническое задание (ТЗ)',
  tu: 'Технические условия (ТУ)',
  kp: 'Коммерческое предложение (КП)',
  estimate: 'Смета',
  contract: 'Договор подряда',
  addendum: 'Дополнительное соглашение',
  ks2: 'Акт КС-2',
  ks3: 'Справка КС-3',
  permit: 'Разрешение на строительство',
  boundary_act: 'Акт разграничения',
  other: 'Прочее',
};

const CUSTOMER_STAGE_STATUS_LABELS = {
  pending: 'Запланировано',
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Выполнено',
  not_done: 'Не выполнено',
};

async function initCustomerProjectPage() {
  try {
    currentUser = await requireAuth('customer');
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
    <span class="badge ${CUSTOMER_STATUS_CLASSES[status] || 'badge-gray'}">${escHtml(status)}</span>
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
  return CUSTOMER_STATUS_LABELS[status] || status || '—';
}

async function switchProjectTab(tab, options = {}) {
  activeTab = ['overview', 'stages', 'documents', 'warehouse'].includes(tab) ? tab : 'overview';

  document.querySelectorAll('[data-project-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.projectTab === activeTab);
  });

  document.getElementById('tab-overview').style.display = activeTab === 'overview' ? '' : 'none';
  document.getElementById('tab-stages').style.display = activeTab === 'stages' ? '' : 'none';
  document.getElementById('tab-documents').style.display = activeTab === 'documents' ? '' : 'none';
  document.getElementById('tab-warehouse').style.display = activeTab === 'warehouse' ? '' : 'none';

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
        <div class="foreman-stage-progress-track"><span style="width:${stats.progress}%"></span></div>
        <div class="customer-overview-metrics">
          <div><span>В работе</span><strong>${stats.inProgress}</strong></div>
          <div><span>Проблемы</span><strong>${stats.notDone}</strong></div>
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
  const notDone = stages.filter((stage) => stage.status === 'not_done').length;
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

  if (!docs.length) {
    items.push({
      type: 'muted',
      title: 'Документы ещё не загружены',
      text: 'Как только команда добавит файлы, они появятся в разделе документов',
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
  return `
    <button class="customer-overview-stage" type="button" data-overview-stage-id="${stage.id}">
      <div>
        <strong>${escHtml(stage.name)}</strong>
        <span>${formatPlannedPeriod(stage)} · ${CUSTOMER_STAGE_STATUS_LABELS[stage.status] || stage.status || '—'}</span>
      </div>
      <em>${getStagePercent(stage)}%</em>
    </button>
  `;
}

function renderOverviewDoc(doc) {
  return `
    <a class="customer-overview-doc" href="${doc.url}" target="_blank" rel="noopener">
      <strong>${escHtml(doc.file_name)}</strong>
      <span>${escHtml(CUSTOMER_DOC_LABELS[doc.doc_type] || doc.doc_type || 'Документ')} · ${formatDate(doc.uploaded_at)}</span>
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
  const notDone = stagesCache.filter((stage) => stage.status === 'not_done').length;
  const inProgress = stagesCache.filter((stage) => stage.status === 'in_progress').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  container.innerHTML = `
    <div class="foreman-stage-overview customer-stage-overview">
      <div class="foreman-stage-progress-card">
        <div>
          <span>Готовность по этапам</span>
          <strong>${pct}%</strong>
        </div>
        <div class="foreman-stage-progress-track"><span style="width:${pct}%"></span></div>
      </div>
      <div class="foreman-stage-stats">
        <div><span>Всего</span><strong>${total}</strong></div>
        <div><span>Выполнено</span><strong>${done}</strong></div>
        <div><span>В работе</span><strong>${inProgress}</strong></div>
        <div><span>Проблемы</span><strong>${notDone}</strong></div>
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
  const statusLabel = CUSTOMER_STAGE_STATUS_LABELS[stage.status] || stage.status || '—';
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
      <div class="foreman-stage-status ${statusClass}">${escHtml(needsApproval ? 'Требует согласования' : statusLabel)}</div>
      <div class="foreman-stage-progress-row">
        <div class="foreman-stage-progress-track"><span style="width:${pct}%"></span></div>
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
  if (stage.status === 'done') return 'is-done';
  if (stage.status === 'in_progress') return 'is-progress';
  if (stage.status === 'not_done') return 'is-danger';
  return 'is-planned';
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
        ${escHtml(CUSTOMER_STAGE_STATUS_LABELS[stage.status] || stage.status || '—')}
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
          <span style="color:var(--muted)">Загрузка...</span>
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
    grid.innerHTML = '<span style="color:var(--muted)">Фото пока нет</span>';
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
          ${escHtml(CUSTOMER_DOC_LABELS[doc.doc_type] || doc.doc_type || 'Документ')}
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
            const balanceColor = balance > 0 ? 'var(--success)' : balance < 0 ? 'var(--danger)' : 'var(--muted)';
            return `
              <tr>
                <td>${escHtml(item.material_name)}</td>
                <td>${escHtml(item.unit || '—')}</td>
                <td>${formatNumber(item.qty_total)}</td>
                <td>${formatNumber(item.qty_used)}</td>
                <td style="font-weight:800;color:${balanceColor}">${formatNumber(item.qty_balance)}</td>
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
