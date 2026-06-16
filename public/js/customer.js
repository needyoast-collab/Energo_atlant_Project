let currentUser = null;
let projectsList = [];
let activeProjectId = null;
let stagesCache = [];
let requestManualPhone = '';
let pendingDocumentHighlightId = null;
// projectId (string) → array of unread document notification ids
let unreadDocNotifs = {};

function customerBadge(status) {
  const label = CustomerStatus.getProjectLabel(status);
  const cls = CustomerStatus.getProjectBadgeClass(status);
  return `<span class="badge ${cls}">${label}</span>`;
}

function customerStageBadge(stage) {
  return `<span class="badge ${CustomerStatus.getStageBadgeClass(stage)} customer-stage-badge">${escHtml(CustomerStatus.getStageLabel(stage))}</span>`;
}

const DOC_LABELS = window.PROJECT_DOC_LABELS;

const WAREHOUSE_SOURCE_LABELS = {
  company: 'Склад компании',
  purchase: 'Закупка',
  customer: 'Давальческий',
};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.CUSTOMER);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    initNotificationBell();
    initRequestPhonePrefill();
    await loadProjects();
    openInitialSectionFromUrl();
  } finally {
    window.hidePreloader?.();
  }
}

function openInitialSectionFromUrl() {
  const section = new URLSearchParams(window.location.search).get('section');
  if (!section) return;
  const button = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (button) button.click();
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'messages') loadMessages();
});

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const [projRes, notifRes] = await Promise.all([
    apiRequest('GET', '/api/customer/projects'),
    apiRequest('GET', '/api/notifications'),
  ]);
  if (!projRes.ok) return;
  projectsList = projRes.data.data;

  unreadDocNotifs = {};
  if (notifRes.ok) {
    (notifRes.data.data || []).forEach(n => {
      if (n.type === 'document' && !n.is_read && n.project_id) {
        const key = String(n.project_id);
        if (!unreadDocNotifs[key]) unreadDocNotifs[key] = [];
        unreadDocNotifs[key].push(n.id);
      }
    });
  }

  const container = document.getElementById('projects-list');
  if (!projectsList.length) {
    container.innerHTML = `
      <div class="card customer-empty-projects">
        <div class="customer-empty-icon">🏗</div>
        <div class="customer-empty-title">У вас пока нет объектов</div>
        <div class="customer-empty-text">Оставьте заявку или войдите по коду проекта</div>
      </div>`;
    return;
  }

  container.innerHTML = projectsList.map(p => {
    const stageTotal = parseInt(p.stage_total) || 0;
    const stageDone = parseInt(p.stage_done) || 0;
    const pct = stageTotal ? Math.round(stageDone / stageTotal * 100) : 0;
    const managerName = p.manager_name || 'Менеджер назначен';
    const isActive = p.status === 'work';

    return `
    <div class="project-card-customer" data-action="open-project" data-id="${p.id}">
      <div class="pcc-header">
        <div class="pcc-title">${escHtml(p.name)}</div>
        ${customerBadge(p.status)}
      </div>
      <div class="pcc-meta">
        <span>${escHtml(p.code)}</span>
        ${p.address ? `<span>· 📍 ${escHtml(p.address)}</span>` : ''}
      </div>
      <div class="pcc-progress-wrap">
        <div class="pcc-progress-label">
          <span>Прогресс</span>
          <span class="pcc-progress-value">${pct}%</span>
        </div>
        <progress class="pcc-progress-bar" value="${pct}" max="100"></progress>
      </div>
      <div class="pcc-stats-row">
        <div class="pcc-stat">
          <div class="pcc-stat-val">${p.photo_count}</div>
          <div class="pcc-stat-lbl">фото</div>
        </div>
        <div class="pcc-stat">
          <div class="pcc-stat-val pcc-stat-docs">
            ${p.doc_count}
            ${unreadDocNotifs[String(p.id)]?.length ? `<span class="doc-new-dot" data-project-id="${p.id}"></span>` : ''}
          </div>
          <div class="pcc-stat-lbl">документов</div>
        </div>
        <div class="pcc-stat">
          <div class="pcc-stat-val">${stageDone}<span class="pcc-stat-total">/${stageTotal}</span></div>
          <div class="pcc-stat-lbl">этапов</div>
        </div>
      </div>
      <div class="pcc-footer">
        <span class="pcc-manager">Менеджер: <strong>${escHtml(managerName)}</strong></span>
        <span class="${isActive ? 'pcc-online' : 'pcc-offline'}">● ${isActive ? 'Онлайн' : 'Офлайн'}</span>
      </div>
    </div>`;
  }).join('');
}

async function openCustomerProject(projectId, tab = 'overview', notification = null) {
  const url = new URL('/customer_project.html', window.location.origin);
  url.searchParams.set('id', projectId);
  url.searchParams.set('tab', tab);

  if (notification?.entity_type === 'stage' && notification.entity_id) {
    url.searchParams.set('stage', notification.entity_id);
  }
  if (notification?.entity_type === 'document' && notification.entity_id) {
    url.searchParams.set('doc', notification.entity_id);
  }

  window.location.href = url.toString();
}

function extractStageNameFromNotification(message) {
  const quoted = message.match(/Этап «(.+?)»/);
  if (quoted) return quoted[1];
  const afterColon = message.match(/по этапу:\s*(.+)$/i);
  return afterColon ? afterColon[1].trim() : '';
}

document.getElementById('projects-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  await openCustomerProject(card.dataset.id);
});

document.addEventListener('notification:open', async (e) => {
  const notification = e.detail;
  if (!notification?.project_id) return;
  const tab = notification.type === 'document' ? 'documents' : 'stages';
  await openCustomerProject(notification.project_id, tab, notification);
});

// ─── Вкладки ─────────────────────────────────────────────────
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', async () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'documents') {
      loadDocuments(activeProjectId);
      clearDocDot(activeProjectId);
    }
    if (btn.dataset.tab === 'warehouse') loadWarehouse(activeProjectId);
  });
});

async function clearDocDot(projectId) {
  const key = String(projectId);
  const ids = unreadDocNotifs[key];
  if (!ids?.length) return;
  delete unreadDocNotifs[key];
  document.querySelectorAll(`.doc-new-dot[data-project-id="${projectId}"]`).forEach(el => el.remove());
  await Promise.all(ids.map(id => apiRequest('PUT', `/api/notifications/${id}/read`)));
}

function switchTab(tab) {
  document.getElementById('tab-stages').classList.toggle('is-hidden', tab !== 'stages');
  document.getElementById('tab-documents').classList.toggle('is-hidden', tab !== 'documents');
  document.getElementById('tab-warehouse').classList.toggle('is-hidden', tab !== 'warehouse');
  document.querySelectorAll('[data-tab]').forEach(b => {
    b.className = b.dataset.tab === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  });
}

// ─── Ход работ ───────────────────────────────────────────────
async function loadStages(id) {
  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${id}/stages`);
  if (!ok) return;

  const stages = data.data;
  const total = stages.length;

  const vorStages = stages.filter(s => s.is_from_vor && Number(s.planned_value) > 0);
  let pct;
  if (vorStages.length) {
    const sumPlan = vorStages.reduce((a, s) => a + Number(s.planned_value), 0);
    const sumActual = vorStages.reduce((a, s) => a + Number(s.actual_value || 0), 0);
    pct = sumPlan > 0 ? Math.min(100, Math.round(sumActual / sumPlan * 100)) : 0;
  } else {
    const done = stages.filter(s => s.status === 'done').length;
    pct = total ? Math.round(done / total * 100) : 0;
  }

  document.getElementById('stages-progress').innerHTML = total ? `
    <div class="customer-stage-progress-wrap">
      <div class="customer-stage-progress-label">
        <span>Готовность</span>
        <span class="customer-stage-progress-value">${pct}%</span>
      </div>
      <progress class="customer-stage-progress-bar" value="${pct}" max="100"></progress>
    </div>
  ` : '';

  const list = document.getElementById('stages-list');
  if (!stages.length) {
    list.innerHTML = '<div class="text-muted">Этапы ещё не добавлены</div>';
    return;
  }

  stagesCache = stages;

  list.innerHTML = stages.map(s => {
    const needsAttention = CustomerStatus.getStageKind(s) === 'attention';

    let subInfo = '';
    if (s.is_from_vor) {
      subInfo = `${s.actual_value != null ? s.actual_value : 0} / ${s.planned_value} ${escHtml(s.unit || '')}`;
      if (s.planned_start && s.planned_end) subInfo += ` · план: ${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`;
      else if (s.planned_date) subInfo += ` · план: ${formatDate(s.planned_date)}`;
      if (s.actual_date) subInfo += ` · факт: ${formatDate(s.actual_date)}`;
    } else {
      if (s.planned_start) subInfo += `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`;
      if (s.actual_end) subInfo += ` · Сдан: ${formatDate(s.actual_end)}`;
      if (s.photo_count > 0) subInfo += ` · 📷 ${s.photo_count} фото`;
    }
    if (s.note && !s.is_from_vor) subInfo += ` · пояснение: ${escHtml(s.note)}`;

    return `
    <div class="stage-item customer-stage-item ${needsAttention ? 'needs-attention' : ''}"
         data-action="open-stage" data-id="${s.id}">
      <div class="stage-status-dot ${CustomerStatus.getStageDotClass(s)}"></div>
      <div class="customer-stage-content">
        <div class="stage-name">${escHtml(s.name)}</div>
        <div class="stage-dates">${subInfo}</div>
      </div>
      ${customerStageBadge(s)}
    </div>`;
  }).join('');
}

// ─── Детальная модалка этапа ──────────────────────────────────
let approveStageId = null;

document.getElementById('stages-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-action="open-stage"]');
  if (!item) return;
  const stage = stagesCache.find(s => s.id == item.dataset.id);
  if (stage) openStageDetailModal(stage);
});

function openStageDetailModal(s) {
  approveStageId = s.id;
  const project = projectsList.find((item) => item.id == activeProjectId);

  const isNotDone = s.status === 'not_done';
  const isAgreed = s.customer_agreed;

  let detailRows = '';

  if (s.is_from_vor) {
    detailRows += row('Объём (план)', `${s.planned_value} ${escHtml(s.unit || '')}`);
    detailRows += row('Объём (факт)', `${s.actual_value != null ? s.actual_value : 0} ${escHtml(s.unit || '')}`);
    if (s.planned_start && s.planned_end) detailRows += row('Плановый период', `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`);
    else if (s.planned_date) detailRows += row('Плановое окончание', formatDate(s.planned_date));
    if (s.actual_date) detailRows += row('Фактическое окончание', formatDate(s.actual_date));
  } else {
    if (s.planned_start) detailRows += row('Период', `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`);
    if (s.actual_end) detailRows += row('Сдан', formatDate(s.actual_end));
  }

  const noteBlock = s.note
    ? `<div class="customer-note-block">
         <div class="customer-note-label">Пояснение</div>
         <div class="customer-note-text ${isNotDone ? 'is-danger' : ''}">${escHtml(s.note)}</div>
       </div>`
    : '';

  const approveBlock = (isNotDone && !isAgreed)
    ? `<div class="customer-approval-card">
         <div class="customer-approval-title">⚠ Требует вашего согласования</div>
         <p class="customer-approval-text">
           Ознакомьтесь с примечанием прораба и подтвердите, что приняли информацию к сведению.
         </p>
         <button class="btn btn-primary btn-sm" id="btn-approve-in-modal">Согласовать</button>
       </div>`
    : isAgreed && isNotDone
      ? `<div class="customer-stage-approved">✓ Вы согласовали этот этап</div>`
      : '';

  const photosBlock = Number(s.photo_count) > 0
    ? `<div class="customer-photos-block">
         <div class="customer-photos-title">Фото (${s.photo_count})</div>
         <div id="stage-photos-grid" class="customer-photos-grid">
           <div class="text-muted customer-empty-text">Загрузка...</div>
         </div>
       </div>`
    : '';

  document.getElementById('stage-detail-body').innerHTML = `
    <div class="customer-stage-detail-head">
      <div class="customer-stage-project-name">${escHtml(project?.name || 'Проект')}</div>
      <div class="customer-stage-name-muted">${escHtml(s.name)}</div>
    </div>
    <div class="customer-stage-badge-row">${customerStageBadge(s)}</div>
    <div class="customer-stage-detail-grid">${detailRows}</div>
    ${noteBlock}
    ${photosBlock}
    ${approveBlock}
  `;

  openModal('modal-stage-detail');

  if (Number(s.photo_count) > 0) loadStagePhotos(s.id);

  const approveBtn = document.getElementById('btn-approve-in-modal');
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      approveBtn.disabled = true;
      const { ok, data } = await apiRequest(
        'PUT', `/api/customer/projects/${activeProjectId}/stages/${approveStageId}/approve`
      );
      approveBtn.disabled = false;
      if (ok) {
        showToast('Этап согласован', 'success');
        closeModal('modal-stage-detail');
        loadStages(activeProjectId);
      } else showToast(data.error, 'error');
    });
  }
}

function row(label, value) {
  return `<div class="customer-stage-detail-row">
    <span class="customer-stage-detail-label">${label}</span>
    <span>${value}</span>
  </div>`;
}

async function loadStagePhotos(stageId) {
  const grid = document.getElementById('stage-photos-grid');
  if (!grid) return;
  const { ok, data } = await apiRequest('GET', `/api/customer/stages/${stageId}/photos`);
  if (!ok || !data.data.length) { grid.innerHTML = '<span class="text-muted customer-empty-text">Нет фото</span>'; return; }
  grid.innerHTML = data.data.map(p => `
    <a href="${safeAttrUrl(p.url)}" target="_blank" rel="noopener" class="stage-photo-thumb">
      <img src="${safeAttrUrl(p.url)}" alt="${escAttr(p.description || '')}">
    </a>
  `).join('');
}

// ─── Документы ───────────────────────────────────────────────
async function loadDocuments(id) {
  const container = document.getElementById('documents-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';

  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }

  if (!data.data.length) {
    container.innerHTML = '<span class="text-muted">Документов пока нет</span>';
    return;
  }

  container.innerHTML = data.data.map(doc => `
    <div data-doc-id="${doc.id}" class="customer-doc-row">
      <div>
        <div class="customer-doc-title">${escHtml(doc.doc_label || DOC_LABELS[doc.doc_type] || doc.doc_type)}</div>
        <div class="customer-doc-file">
          ${escHtml(doc.file_name)}
          ${doc.description ? ' — ' + escHtml(doc.description) : ''}
        </div>
        <div class="customer-doc-meta">${formatDate(doc.uploaded_at)} · ${escHtml(doc.uploaded_by_name)}</div>
      </div>
      <a href="${safeAttrUrl(doc.url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm customer-doc-download">
        Скачать
      </a>
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

// ─── Материалы (склад) ───────────────────────────────────────
async function loadWarehouse(id) {
  const container = document.getElementById('warehouse-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${id}/warehouse`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span class="text-muted">Позиций нет</span>'; return; }

  container.innerHTML = `
    <div class="customer-warehouse-note">Остатки материалов на объекте</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Материал</th><th>Ед.</th><th>Получено</th><th>Использовано</th><th>Остаток</th></tr>
        </thead>
        <tbody>
          ${data.data.map(r => {
            const balanceClass = Number(r.qty_balance) > 0
              ? 'text-success'
              : Number(r.qty_balance) < 0
                ? 'text-danger'
                : 'text-muted';
            return `
            <tr>
              <td>${escHtml(r.material_name)}</td>
              <td>${escHtml(r.unit || '—')}</td>
              <td>${r.qty_total}</td>
              <td>${r.qty_used}</td>
              <td class="customer-warehouse-balance ${balanceClass}">
                ${r.qty_balance}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Заявка — мульти-файловая очередь ────────────────────────
let attachedFiles = [];

const REQUEST_DOC_LABELS = window.REQUEST_DOC_LABELS;

function truncateFilename(name, maxLen = 40) {
  if (name.length <= maxLen) return name;
  const tail = 15;
  const head = maxLen - tail - 3;
  return name.slice(0, head) + '...' + name.slice(-tail);
}

function renderFilesList() {
  const container = document.getElementById('req-files-list');
  if (!attachedFiles.length) { container.innerHTML = ''; return; }
  container.innerHTML = attachedFiles.map((f, i) => `
    <div class="request-file-item">
      <span class="request-file-type">${escHtml(REQUEST_DOC_LABELS[f.docType] || '—')}</span>
      <span class="request-file-divider">|</span>
      <span class="request-file-name">${escHtml(truncateFilename(f.file.name))}</span>
      <button type="button" class="request-file-remove" data-remove-file="${i}">×</button>
    </div>`).join('');
}

(function () {
  const fileInput = document.getElementById('req-file-input');
  const fileNameEl = document.getElementById('req-selected-filename');
  const errorEl = document.getElementById('req-file-error');
  const ALLOWED = ['pdf', 'dwg', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'];
  const MAX = 10 * 1024 * 1024;

  fileInput.addEventListener('change', () => {
    errorEl.classList.add('is-hidden');
    const file = fileInput.files[0];
    if (!file) { fileNameEl.classList.add('is-hidden'); return; }
    fileNameEl.textContent = truncateFilename(file.name);
    fileNameEl.classList.remove('is-hidden');
  });

  document.getElementById('btn-add-file').addEventListener('click', () => {
    errorEl.classList.add('is-hidden');
    const file = fileInput.files[0];
    if (!file) {
      errorEl.textContent = 'Сначала выберите файл';
      errorEl.classList.remove('is-hidden'); return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      errorEl.textContent = 'Недопустимый формат. Разрешены: PDF, DWG, DOC, DOCX, XLS, XLSX, JPG, PNG, WEBP';
      errorEl.classList.remove('is-hidden'); return;
    }
    if (file.size > MAX) {
      errorEl.textContent = 'Файл превышает 10 МБ';
      errorEl.classList.remove('is-hidden'); return;
    }
    const docType = document.getElementById('req-doc-type').value;
    attachedFiles.push({ file, docType });
    fileInput.value = '';
    fileNameEl.classList.add('is-hidden');
    document.getElementById('req-doc-type').value = '';
    renderFilesList();
  });

  document.getElementById('req-files-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-file]');
    if (!btn) return;
    attachedFiles.splice(parseInt(btn.dataset.removeFile), 1);
    renderFilesList();
  });
})();

function resetRequestForm() {
  attachedFiles = [];
  document.getElementById('req-files-list').innerHTML = '';
  document.getElementById('req-selected-filename').classList.add('is-hidden');
  document.getElementById('req-file-error').classList.add('is-hidden');
  document.getElementById('req-file-input').value = '';
  document.getElementById('req-doc-type').value = '';
  requestManualPhone = '';
  const checkboxWrap = document.getElementById('request-use-account-phone-wrap');
  const checkbox = document.getElementById('request-use-account-phone');
  const phoneInput = document.querySelector('#request-form [name="phone"]');
  if (checkboxWrap) {
    checkboxWrap.classList.toggle('is-hidden', !currentUser?.phone);
  }
  if (checkbox) checkbox.checked = false;
  if (phoneInput) {
    phoneInput.readOnly = false;
    phoneInput.value = '';
  }
}

function initRequestPhonePrefill() {
  const checkboxWrap = document.getElementById('request-use-account-phone-wrap');
  const checkbox = document.getElementById('request-use-account-phone');
  const phoneInput = document.querySelector('#request-form [name="phone"]');
  if (!checkbox || !phoneInput) return;

  if (checkboxWrap) {
    checkboxWrap.classList.toggle('is-hidden', !currentUser?.phone);
  }

  const applyAccountPhone = () => {
    const accountPhone = currentUser?.phone || '';
    if (!accountPhone) {
      checkbox.checked = false;
      showToast('В профиле аккаунта не указан номер телефона', 'error');
      return;
    }

    requestManualPhone = phoneInput.value;
    phoneInput.value = accountPhone;
    phoneInput.readOnly = true;
  };

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      applyAccountPhone();
      return;
    }

    phoneInput.readOnly = false;
    phoneInput.value = requestManualPhone || '';
  });

  phoneInput.addEventListener('input', () => {
    if (!checkbox.checked) {
      requestManualPhone = phoneInput.value;
    }
  });
}

// ─── Заявка ──────────────────────────────────────────────────
document.getElementById('btn-new-request').addEventListener('click', () => {
  document.getElementById('request-form').reset();
  resetRequestForm();
  openModal('modal-request');
});

document.getElementById('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  const formData = new FormData(e.target);
  const fd = new FormData();
  const phone = formData.get('phone') || '';
  const message = formData.get('message') || '';
  if (phone) fd.append('phone', phone);
  if (message) fd.append('message', message);
  for (const af of attachedFiles) {
    fd.append('files', af.file);
    fd.append('doc_types', af.docType || '');
  }

  const { ok, data } = await apiRequest('POST', '/api/customer/requests', fd);
  btn.disabled = false;

  if (ok) {
    showToast('Заявка отправлена! Менеджер свяжется с вами.', 'success');
    closeModal('modal-request');
    e.target.reset();
    resetRequestForm();
  } else {
    showToast(data?.error || 'Ошибка при отправке', 'error');
  }
});

// ─── Войти по коду ───────────────────────────────────────────
document.getElementById('btn-join-project').addEventListener('click', () => {
  document.getElementById('join-form').reset();
  openModal('modal-join');
});

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get('code').toUpperCase();
  const { ok, data } = await apiRequest('POST', '/api/customer/projects/join', { code });
  if (ok) {
    showToast(`Вы подключены к проекту «${data.data.name}»`, 'success');
    closeModal('modal-join');
    loadProjects();
  } else showToast(data.error, 'error');
});

// ─── Сообщения ───────────────────────────────────────────────
async function loadMessages() {
  const { ok, data } = await apiRequest('GET', '/api/messages');
  if (!ok) return;

  const tbody = document.querySelector('#messages-table tbody');
  tbody.innerHTML = data.data.map(m => {
    const isOut = m.sender_id === currentUser.id;
    return `
      <tr>
        <td>${isOut ? `→ ${escHtml(m.receiver_name)}` : `← ${escHtml(m.sender_name)}`}</td>
        <td>${escHtml(m.subject || '(без темы)')}</td>
        <td class="customer-message-date">${formatDate(m.created_at)}</td>
        <td>${!isOut && !m.is_read ? '<span class="badge badge-blue">Новое</span>' : '<span class="badge badge-gray">Прочитано</span>'}</td>
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
  const email = fd.get('receiver_email');
  const { ok: uok, data: udata } = await apiRequest('GET', `/api/messages/find-user?email=${encodeURIComponent(email)}`);
  if (!uok) return showToast(udata?.error || 'Пользователь не найден', 'error');

  const { ok, data } = await apiRequest('POST', '/api/messages', {
    receiver_id: udata.data.id,
    subject: fd.get('subject') || undefined,
    body: fd.get('body'),
  });
  if (ok) {
    showToast('Отправлено', 'success');
    closeModal('modal-new-message');
    loadMessages();
  } else showToast(data.error, 'error');
});

init();
