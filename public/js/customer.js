let currentUser = null;
let projectsList = [];
let activeProjectId = null;
let stagesCache = [];

const VOR_STATUS_LABELS = { planned: 'Запланировано', done: 'Выполнено', not_done: 'Не выполнено' };

// ─── Маппинг статусов для заказчика ──────────────────────────
const CUSTOMER_STATUS_MAP = {
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

const CUSTOMER_STATUS_CLASS = {
  'Рассматривается': 'badge-gray',
  'Согласование': 'badge-yellow',
  'Договор подписан': 'badge-blue',
  'В работе': 'badge-green',
  'Завершён': 'badge-gray',
  'Отменён': 'badge-red',
};

function customerBadge(status) {
  const label = CUSTOMER_STATUS_MAP[status] || status;
  const cls = CUSTOMER_STATUS_CLASS[label] || 'badge-gray';
  return `<span class="badge ${cls}">${label}</span>`;
}

const DOC_LABELS = {
  hidden_works_act: 'Акт скрытых работ',
  exec_scheme: 'Исполнительная схема',
  geodetic_survey: 'Геодезическая съёмка',
  general_works_log: 'Общий журнал работ',
  author_supervision: 'Журнал авторского надзора',
  interim_acceptance: 'Акт промежуточной приёмки',
  cable_test_act: 'Акт испытания КЛ',
  measurement_protocol: 'Протокол измерений',
  rd: 'Рабочая документация (РД)', pd: 'Проектная документация (ПД)',
  tz: 'Техническое задание (ТЗ)', tu: 'Технические условия (ТУ)',
  kp: 'Коммерческое предложение (КП)', estimate: 'Смета',
  contract: 'Договор подряда', addendum: 'Дополнительное соглашение',
  ks2: 'Акт КС-2', ks3: 'Справка КС-3',
  permit: 'Разрешение на строительство', boundary_act: 'Акт разграничения',
  other: 'Прочее',
};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('customer');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  initNotificationBell();
  loadProjects();
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'messages') loadMessages();
});

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/customer/projects');
  if (!ok) return;
  projectsList = data.data;

  const container = document.getElementById('projects-list');
  if (!projectsList.length) {
    container.innerHTML = `
      <div class="card" style="color:var(--muted);text-align:center;padding:2.5rem;grid-column:1/-1">
        <div style="font-size:2rem;margin-bottom:1rem">🏗</div>
        <div style="margin-bottom:.5rem">У вас пока нет объектов</div>
        <div style="font-size:.85rem">Оставьте заявку или войдите по коду проекта</div>
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
          <span style="color:var(--accent);font-weight:700">${pct}%</span>
        </div>
        <div class="pcc-progress-bar">
          <div class="pcc-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="pcc-stats-row">
        <div class="pcc-stat">
          <div class="pcc-stat-val">${p.photo_count}</div>
          <div class="pcc-stat-lbl">фото</div>
        </div>
        <div class="pcc-stat">
          <div class="pcc-stat-val">${p.doc_count}</div>
          <div class="pcc-stat-lbl">актов ИД</div>
        </div>
        <div class="pcc-stat">
          <div class="pcc-stat-val">${stageDone}<span style="font-size:.9rem;color:var(--muted)">/${stageTotal}</span></div>
          <div class="pcc-stat-lbl">этапов</div>
        </div>
      </div>
      <div class="pcc-footer">
        <span style="color:var(--muted)">Менеджер: <strong style="color:var(--text)">${escHtml(managerName)}</strong></span>
        <span style="color:${isActive ? 'var(--success)' : 'var(--muted)'}">● ${isActive ? 'Онлайн' : 'Офлайн'}</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('projects-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  activeProjectId = card.dataset.id;
  const project = projectsList.find(p => p.id == activeProjectId);
  if (!project) return;

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.5rem">
      ${badge(project.status)}
      <span style="color:var(--muted);font-size:.85rem">${escHtml(project.code)}</span>
      ${project.address ? `<span style="color:var(--muted);font-size:.85rem">📍 ${escHtml(project.address)}</span>` : ''}
    </div>
    ${project.contract_value ? `<div style="color:var(--muted);font-size:.85rem">Сумма договора: <strong style="color:var(--text)">${formatMoney(project.contract_value)}</strong></div>` : ''}
    ${project.manager_name ? `<div style="color:var(--muted);font-size:.85rem">Менеджер: <strong style="color:var(--text)">${escHtml(project.manager_name)}</strong></div>` : ''}
  `;

  switchTab('stages');
  await loadStages(activeProjectId);
  openModal('modal-project');
});

// ─── Вкладки ─────────────────────────────────────────────────
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', async () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'documents') loadDocuments(activeProjectId);
    if (btn.dataset.tab === 'warehouse') loadWarehouse(activeProjectId);
  });
});

function switchTab(tab) {
  document.getElementById('tab-stages').style.display = tab === 'stages' ? '' : 'none';
  document.getElementById('tab-documents').style.display = tab === 'documents' ? '' : 'none';
  document.getElementById('tab-warehouse').style.display = tab === 'warehouse' ? '' : 'none';
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
  let pct, progressSub;
  if (vorStages.length) {
    const sumPlan = vorStages.reduce((a, s) => a + Number(s.planned_value), 0);
    const sumActual = vorStages.reduce((a, s) => a + Number(s.actual_value || 0), 0);
    pct = sumPlan > 0 ? Math.min(100, Math.round(sumActual / sumPlan * 100)) : 0;
    progressSub = `Выполнено: ${sumActual.toFixed(2)} из ${sumPlan.toFixed(2)} (объём работ)`;
  } else {
    const done = stages.filter(s => s.status === 'done').length;
    pct = total ? Math.round(done / total * 100) : 0;
    progressSub = `${done} из ${total} этапов завершено`;
  }

  document.getElementById('stages-progress').innerHTML = total ? `
    <div style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.4rem">
        <span style="color:var(--muted)">Готовность</span>
        <span style="font-weight:700;color:var(--accent)">${pct}%</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:9999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:9999px;transition:width .5s"></div>
      </div>
      <div style="color:var(--muted);font-size:.8rem;margin-top:.4rem">${progressSub}</div>
    </div>
  ` : '';

  const list = document.getElementById('stages-list');
  if (!stages.length) {
    list.innerHTML = '<div style="color:var(--muted)">Этапы ещё не добавлены</div>';
    return;
  }

  stagesCache = stages;

  list.innerHTML = stages.map(s => {
    const isNotDone = s.status === 'not_done';
    const isAgreed = s.customer_agreed;

    let subInfo = '';
    if (s.is_from_vor) {
      subInfo = `${s.actual_value != null ? s.actual_value : 0} / ${s.planned_value} ${escHtml(s.unit || '')}`;
      if (s.planned_date) subInfo += ` · план: ${formatDate(s.planned_date)}`;
      if (s.actual_date) subInfo += ` · факт: ${formatDate(s.actual_date)}`;
    } else {
      if (s.planned_start) subInfo += `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`;
      if (s.actual_end) subInfo += ` · Сдан: ${formatDate(s.actual_end)}`;
      if (s.photo_count > 0) subInfo += ` · 📷 ${s.photo_count} фото`;
    }

    const statusBadge = isNotDone
      ? `<span class="badge badge-red" style="font-size:.72rem">${isAgreed ? 'Согласовано' : 'Требует согласования'}</span>`
      : badge(s.status);

    return `
    <div class="stage-item" style="cursor:pointer${isNotDone && !isAgreed ? ';border-left:2px solid var(--danger);padding-left:.5rem' : ''}"
         data-action="open-stage" data-id="${s.id}">
      <div class="stage-status-dot dot-${s.status}"></div>
      <div style="flex:1">
        <div class="stage-name">${escHtml(s.name)}</div>
        <div class="stage-dates">${subInfo}</div>
      </div>
      ${statusBadge}
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

  const isNotDone = s.status === 'not_done';
  const isAgreed = s.customer_agreed;
  const statusLabel = s.is_from_vor
    ? (VOR_STATUS_LABELS[s.status] || s.status)
    : (s.status === 'pending' ? 'Не начат' : s.status === 'in_progress' ? 'В работе' : s.status === 'done' ? 'Завершён' : s.status);

  let detailRows = '';

  if (s.is_from_vor) {
    detailRows += row('Объём (план)', `${s.planned_value} ${escHtml(s.unit || '')}`);
    detailRows += row('Объём (факт)', `${s.actual_value != null ? s.actual_value : 0} ${escHtml(s.unit || '')}`);
    if (s.planned_date) detailRows += row('Плановая дата', formatDate(s.planned_date));
    if (s.actual_date) detailRows += row('Фактическая дата', formatDate(s.actual_date));
  } else {
    if (s.planned_start) detailRows += row('Период', `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}`);
    if (s.actual_end) detailRows += row('Сдан', formatDate(s.actual_end));
  }

  const noteBlock = s.note
    ? `<div style="margin-top:1rem">
         <div style="font-size:.8rem;color:var(--muted);margin-bottom:.35rem">Примечание прораба</div>
         <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.75rem;
                     font-size:.88rem;line-height:1.5${isNotDone ? ';border-color:var(--danger)' : ''}">${escHtml(s.note)}</div>
       </div>`
    : '';

  const approveBlock = (isNotDone && !isAgreed)
    ? `<div style="margin-top:1.25rem;padding:1rem;background:rgba(239,68,68,.08);border:1px solid var(--danger);border-radius:10px">
         <div style="color:var(--danger);font-weight:600;font-size:.88rem;margin-bottom:.5rem">⚠ Требует вашего согласования</div>
         <p style="color:var(--muted);font-size:.82rem;margin-bottom:.75rem">
           Ознакомьтесь с примечанием прораба и подтвердите, что приняли информацию к сведению.
         </p>
         <button class="btn btn-primary btn-sm" id="btn-approve-in-modal">Согласовать</button>
       </div>`
    : isAgreed && isNotDone
      ? `<div style="margin-top:1rem;color:var(--muted);font-size:.85rem">✓ Вы согласовали этот этап</div>`
      : '';

  const photosBlock = Number(s.photo_count) > 0
    ? `<div style="margin-top:1.25rem">
         <div style="font-size:.8rem;color:var(--muted);margin-bottom:.5rem">Фото (${s.photo_count})</div>
         <div id="stage-photos-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:.5rem">
           <div style="color:var(--muted);font-size:.82rem">Загрузка...</div>
         </div>
       </div>`
    : '';

  document.getElementById('stage-detail-body').innerHTML = `
    <div class="modal-title" style="margin-bottom:.75rem">${escHtml(s.name)}</div>
    <div style="margin-bottom:1rem">${badge(s.status)} <span style="font-size:.85rem;color:var(--muted);margin-left:.4rem">${statusLabel}</span></div>
    <div style="display:grid;gap:.4rem">${detailRows}</div>
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
  return `<div style="display:flex;gap:.5rem;font-size:.88rem">
    <span style="color:var(--muted);min-width:130px;flex-shrink:0">${label}</span>
    <span>${value}</span>
  </div>`;
}

async function loadStagePhotos(stageId) {
  const grid = document.getElementById('stage-photos-grid');
  if (!grid) return;
  const { ok, data } = await apiRequest('GET', `/api/customer/stages/${stageId}/photos`);
  if (!ok || !data.data.length) { grid.innerHTML = '<span style="color:var(--muted);font-size:.82rem">Нет фото</span>'; return; }
  grid.innerHTML = data.data.map(p => `
    <a href="${p.url}" target="_blank" rel="noopener" class="stage-photo-thumb">
      <img src="${p.url}" alt="${escHtml(p.description || '')}">
    </a>
  `).join('');
}

// ─── Документы ───────────────────────────────────────────────
async function loadDocuments(id) {
  const container = document.getElementById('documents-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';

  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }

  if (!data.data.length) {
    container.innerHTML = '<span style="color:var(--muted)">Документов пока нет</span>';
    return;
  }

  container.innerHTML = data.data.map(doc => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600;font-size:.9rem">${escHtml(DOC_LABELS[doc.doc_type] || doc.doc_type)}</div>
        <div style="color:var(--muted);font-size:.8rem">
          ${escHtml(doc.file_name)}
          ${doc.description ? ' — ' + escHtml(doc.description) : ''}
        </div>
        <div style="color:var(--muted);font-size:.78rem">${formatDate(doc.uploaded_at)} · ${escHtml(doc.uploaded_by_name)}</div>
      </div>
      <a href="${doc.url}" target="_blank" class="btn btn-outline btn-sm" style="flex-shrink:0;margin-left:.75rem;font-size:.78rem">
        Скачать
      </a>
    </div>
  `).join('');
}

// ─── Материалы (склад) ───────────────────────────────────────
async function loadWarehouse(id) {
  const container = document.getElementById('warehouse-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/customer/projects/${id}/warehouse`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }
  if (!data.data.length) { container.innerHTML = '<span style="color:var(--muted)">Позиций нет</span>'; return; }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Материал</th><th>Ед.</th><th>Получено</th><th>Использовано</th><th>Остаток</th></tr>
        </thead>
        <tbody>
          ${data.data.map(r => `
            <tr>
              <td>${escHtml(r.material_name)}</td>
              <td>${escHtml(r.unit || '—')}</td>
              <td>${r.qty_total}</td>
              <td>${r.qty_used}</td>
              <td style="font-weight:600;color:${Number(r.qty_balance) > 0 ? 'var(--success)' : Number(r.qty_balance) < 0 ? 'var(--danger)' : 'var(--muted)'}">
                ${r.qty_balance}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Заявка — мульти-файловая очередь ────────────────────────
let attachedFiles = [];

const REQUEST_DOC_LABELS = {
  tu: 'Технические условия',
  rd: 'Рабочая документация',
  pd: 'Проектная документация',
  tz: 'Техническое задание',
  situation_plan: 'Ситуационный план',
  other: 'Прочее',
};

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
    <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;
                background:var(--bg3);border:1px solid var(--border);border-radius:6px;margin-top:.3rem;font-size:.82rem">
      <span style="color:var(--muted);flex-shrink:0;white-space:nowrap">${escHtml(REQUEST_DOC_LABELS[f.docType] || '—')}</span>
      <span style="color:var(--muted)">|</span>
      <span style="color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(truncateFilename(f.file.name))}</span>
      <button type="button" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;
                                   padding:0 .2rem;line-height:1;flex-shrink:0"
              data-remove-file="${i}">×</button>
    </div>`).join('');
}

(function () {
  const fileInput = document.getElementById('req-file-input');
  const fileNameEl = document.getElementById('req-selected-filename');
  const errorEl = document.getElementById('req-file-error');
  const ALLOWED = ['pdf', 'dwg', 'doc', 'docx', 'xls', 'xlsx'];
  const MAX = 130 * 1024 * 1024;

  fileInput.addEventListener('change', () => {
    errorEl.style.display = 'none';
    const file = fileInput.files[0];
    if (!file) { fileNameEl.style.display = 'none'; return; }
    fileNameEl.textContent = truncateFilename(file.name);
    fileNameEl.style.display = '';
  });

  document.getElementById('btn-add-file').addEventListener('click', () => {
    errorEl.style.display = 'none';
    const file = fileInput.files[0];
    if (!file) {
      errorEl.textContent = 'Сначала выберите файл';
      errorEl.style.display = ''; return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      errorEl.textContent = 'Недопустимый формат. Разрешены: PDF, DWG, DOC, DOCX, XLS, XLSX';
      errorEl.style.display = ''; return;
    }
    if (file.size > MAX) {
      errorEl.textContent = 'Файл превышает 130 МБ';
      errorEl.style.display = ''; return;
    }
    const docType = document.getElementById('req-doc-type').value;
    attachedFiles.push({ file, docType });
    fileInput.value = '';
    fileNameEl.style.display = 'none';
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
  document.getElementById('req-selected-filename').style.display = 'none';
  document.getElementById('req-file-error').style.display = 'none';
  document.getElementById('req-file-input').value = '';
  document.getElementById('req-doc-type').value = '';
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
        <td style="color:var(--muted);font-size:.85rem">${formatDate(m.created_at)}</td>
        <td>${!isOut && !m.is_read ? '<span class="badge badge-blue">Новое</span>' : '<span class="badge badge-gray">Прочитано</span>'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" style="color:var(--muted)">Сообщений нет</td></tr>';
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
