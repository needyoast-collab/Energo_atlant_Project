let currentUser = null;
let projectsList = [];
let activeProjectId = null;

// ─── Маппинг статусов для заказчика ──────────────────────────
const CUSTOMER_STATUS_MAP = {
  lead:          'Рассматривается',
  qualification: 'Рассматривается',
  visit:         'Рассматривается',
  offer:         'Согласование',
  negotiation:   'Согласование',
  contract:      'Договор подписан',
  work:          'В работе',
  won:           'Завершён',
  lost:          'Отменён',
};

const CUSTOMER_STATUS_CLASS = {
  'Рассматривается': 'badge-gray',
  'Согласование':    'badge-yellow',
  'Договор подписан':'badge-blue',
  'В работе':        'badge-green',
  'Завершён':        'badge-gray',
  'Отменён':         'badge-red',
};

function customerBadge(status) {
  const label = CUSTOMER_STATUS_MAP[status] || status;
  const cls   = CUSTOMER_STATUS_CLASS[label] || 'badge-gray';
  return `<span class="badge ${cls}">${label}</span>`;
}

const DOC_LABELS = {
  hidden_works_act:    'Акт скрытых работ',
  exec_scheme:         'Исполнительная схема',
  geodetic_survey:     'Геодезическая съёмка',
  general_works_log:   'Общий журнал работ',
  author_supervision:  'Журнал авторского надзора',
  interim_acceptance:  'Акт промежуточной приёмки',
  cable_test_act:      'Акт испытания КЛ',
  measurement_protocol:'Протокол измерений',
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
    const stageDone  = parseInt(p.stage_done)  || 0;
    const pct        = stageTotal ? Math.round(stageDone / stageTotal * 100) : 0;
    const managerName = p.manager_name || 'Менеджер назначен';
    const isActive   = p.status === 'work';

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
  document.getElementById('tab-stages').style.display    = tab === 'stages'    ? '' : 'none';
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
  const total  = stages.length;
  const done   = stages.filter(s => s.status === 'done').length;
  const pct    = total ? Math.round(done / total * 100) : 0;

  document.getElementById('stages-progress').innerHTML = total ? `
    <div style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.4rem">
        <span style="color:var(--muted)">Готовность</span>
        <span style="font-weight:700;color:var(--accent)">${pct}%</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:9999px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:9999px;transition:width .5s"></div>
      </div>
      <div style="color:var(--muted);font-size:.8rem;margin-top:.4rem">${done} из ${total} этапов завершено</div>
    </div>
  ` : '';

  const list = document.getElementById('stages-list');
  if (!stages.length) {
    list.innerHTML = '<div style="color:var(--muted)">Этапы ещё не добавлены</div>';
    return;
  }

  list.innerHTML = stages.map(s => `
    <div class="stage-item">
      <div class="stage-status-dot dot-${s.status}"></div>
      <div style="flex:1">
        <div class="stage-name">${escHtml(s.name)}</div>
        <div class="stage-dates">
          ${s.planned_start ? `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}` : ''}
          ${s.actual_end ? ` · Сдан: ${formatDate(s.actual_end)}` : ''}
          ${s.photo_count > 0 ? ` · 📷 ${s.photo_count} фото` : ''}
        </div>
      </div>
      ${badge(s.status)}
    </div>
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
          <tr><th>Материал</th><th>Ед.</th><th>План</th><th>Получено</th><th>Использовано</th><th>Остаток</th></tr>
        </thead>
        <tbody>
          ${data.data.map(r => {
            const остаток = Number(r.qty_received) - Number(r.qty_used);
            return `
              <tr>
                <td>${escHtml(r.material_name)}</td>
                <td>${escHtml(r.unit || '—')}</td>
                <td>${r.qty_planned}</td>
                <td>${r.qty_received}</td>
                <td>${r.qty_used}</td>
                <td style="font-weight:600;color:${остаток > 0 ? 'var(--success)' : остаток < 0 ? 'var(--danger)' : 'var(--muted)'}">${остаток}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Зона загрузки файла (заявка) ────────────────────────────
(function () {
  const ALLOWED = ['pdf','dwg','doc','docx','xls','xlsx'];
  const MAX = 10 * 1024 * 1024;
  const zone        = document.getElementById('req-file-zone');
  const input       = document.getElementById('req-file-input');
  const placeholder = document.getElementById('req-file-placeholder');
  const selected    = document.getElementById('req-file-selected');
  const nameEl      = document.getElementById('req-file-name');
  const clearBtn    = document.getElementById('req-file-clear');
  const errorEl     = document.getElementById('req-file-error');

  // Клик по зоне → открыть диалог. stopPropagation на input предотвращает рекурсию.
  zone.addEventListener('click', () => input.click());
  input.addEventListener('click', (e) => e.stopPropagation());

  input.addEventListener('change', () => {
    errorEl.style.display = 'none';
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      errorEl.textContent = 'Недопустимый формат. Разрешены: PDF, DWG, DOC, DOCX, XLS, XLSX';
      errorEl.style.display = 'block';
      input.value = ''; return;
    }
    if (file.size > MAX) {
      errorEl.textContent = 'Файл превышает 10 МБ';
      errorEl.style.display = 'block';
      input.value = ''; return;
    }
    nameEl.textContent = file.name;
    placeholder.style.display = 'none';
    selected.style.display = '';
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    input.value = '';
    placeholder.style.display = '';
    selected.style.display = 'none';
    errorEl.style.display = 'none';
  });
})();

function resetRequestFileZone() {
  document.getElementById('req-file-input').value = '';
  document.getElementById('req-file-placeholder').style.display = '';
  document.getElementById('req-file-selected').style.display = 'none';
  document.getElementById('req-file-error').style.display = 'none';
}

// ─── Заявка ──────────────────────────────────────────────────
document.getElementById('btn-new-request').addEventListener('click', () => {
  document.getElementById('request-form').reset();
  resetRequestFileZone();
  openModal('modal-request');
});

document.getElementById('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('doc_type')) fd.delete('doc_type');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', '/api/customer/requests', fd);
  btn.disabled = false;

  if (ok) {
    showToast('Заявка отправлена! Менеджер свяжется с вами.', 'success');
    closeModal('modal-request');
    e.target.reset();
    resetRequestFileZone();
  } else showToast(data.error, 'error');
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
  if (!uok || !udata.data) return showToast('Пользователь не найден', 'error');

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
