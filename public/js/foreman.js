const SPEC_STATUS = {
  draft: 'Черновик', pending_approval: 'На согласовании',
  approved: 'Согласовано', rejected: 'Отклонено',
};
const SOURCE_LABELS = { company: 'Общий склад', purchase: 'Закупка', customer: 'От заказчика' };
const VOR_STATUS_LABELS = { planned: 'Запланировано', done: 'Выполнено', not_done: 'Не выполнено' };

let currentUser       = null;
let projectsList      = [];
let activeProjectId   = null;
let activeStageId     = null;
let activeStageIsVor  = false;
let activeWarehouseId = null;
let activeSpecId      = null;
let activeWriteoffProjectId = null;
let rejectSpecMode = 'single';
let stageWriteoffItems = [];

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
  actionWrap.style.display = 'flex';
  counter.textContent = `${checkedCount} отмечено из ${checkboxes.length}`;
}

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('foreman');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  initCatalogAutocomplete('foreman');
  loadProjects();
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'mtr')       loadMtrAll();
  if (section === 'warehouse') loadWarehouseAll();
});

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/foreman/projects');
  if (!ok) return;
  projectsList = data.data;

  const container = document.getElementById('projects-list');
  if (!projectsList.length) {
    container.innerHTML = `<div class="card" style="color:var(--muted);text-align:center;padding:2rem">
      Нет проектов. Войдите по коду от менеджера.</div>`;
    return;
  }
  container.innerHTML = projectsList.map(p => `
    <div class="card" style="cursor:pointer" data-action="open-project" data-id="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem">
        <div class="card-title" style="margin:0;font-size:1.1rem">${escHtml(p.name)}</div>
        ${badge(p.status)}
      </div>
      <div style="color:var(--muted);font-size:.82rem;margin-bottom:.25rem">${escHtml(p.code)}</div>
      ${p.address ? `<div style="color:var(--muted);font-size:.82rem">📍 ${escHtml(p.address)}</div>` : ''}
      ${p.manager_name ? `<div style="color:var(--muted);font-size:.82rem;margin-top:.5rem">Менеджер: ${escHtml(p.manager_name)}</div>` : ''}
    </div>
  `).join('');
}

document.getElementById('projects-list').addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  openProject(card.dataset.id);
});

async function openProject(id) {
  activeProjectId = id;
  const project = projectsList.find(p => p.id == id);
  if (!project) return;

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML =
    `${badge(project.status)} <span style="margin-left:.5rem">${escHtml(project.code)}</span>` +
    (project.address ? ` · 📍 ${escHtml(project.address)}` : '');

  switchTab('stages');
  await loadStages(id);
  openModal('modal-project');
}

// ─── Вкладки в модалке проекта ───────────────────────────────
const TABS = ['stages', 'specs', 'work-specs', 'warehouse', 'docs'];

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tab-btn-${t}`).className =
      t === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  });
  if (tab === 'specs')       loadProjectSpecs(activeProjectId);
  if (tab === 'work-specs')  loadWorkSpecs(activeProjectId);
  if (tab === 'warehouse')   loadProjectWarehouse(activeProjectId);
  if (tab === 'docs')        loadProjectDocs(activeProjectId);
}

// ─── Этапы ───────────────────────────────────────────────────
async function loadStages(id) {
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/stages`);
  if (!ok) return;

  const list = document.getElementById('stages-list');
  if (!data.data.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.9rem">Этапов нет. Добавьте первый.</div>';
    return;
  }

  const vorStages = data.data.filter(s => s.is_from_vor && Number(s.planned_value) > 0);
  let progressHtml = '';
  if (vorStages.length) {
    const sumPlan   = vorStages.reduce((a, s) => a + Number(s.planned_value), 0);
    const sumActual = vorStages.reduce((a, s) => a + Number(s.actual_value || 0), 0);
    const pct = sumPlan > 0 ? Math.min(100, Math.round(sumActual / sumPlan * 100)) : 0;
    progressHtml = `
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.35rem">
          <span style="color:var(--muted)">Прогресс (факт/план)</span>
          <span style="font-weight:700;color:var(--accent)">${pct}%</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:9999px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:9999px;transition:width .4s"></div>
        </div>
      </div>`;
  }

  list.innerHTML = progressHtml + data.data.map(s => {
    const isVor = s.is_from_vor;
    const statusLabel = isVor ? (VOR_STATUS_LABELS[s.status] || s.status) : s.status;
    const subInfo = isVor
      ? `${s.actual_value != null ? s.actual_value : 0} / ${s.planned_value} ${escHtml(s.unit || '')}`
        + (s.note ? ` · <span style="color:var(--danger)">${escHtml(s.note)}</span>` : '')
      : (s.planned_start ? `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}` : '')
        + (s.actual_end ? ` · Факт: ${formatDate(s.actual_end)}` : '');

    return `
    <div class="stage-item">
      <div class="stage-status-dot dot-${s.status}"></div>
      <div style="flex:1">
        <div class="stage-name">${escHtml(s.name)}</div>
        <div class="stage-dates">${subInfo}</div>
      </div>
      <div style="display:flex;gap:.4rem;align-items:center">
        ${badge(s.status)}
        <button class="btn btn-outline btn-sm" data-action="edit-stage"
          data-id="${s.id}"
          data-name="${escHtml(s.name)}"
          data-status="${s.status}"
          data-is-vor="${isVor ? '1' : '0'}"
          data-planned-value="${s.planned_value || ''}"
          data-actual-value="${s.actual_value || ''}"
          data-unit="${escHtml(s.unit || '')}"
          data-planned-date="${s.planned_date || ''}"
          data-actual-date="${s.actual_date || ''}"
          data-note="${escHtml(s.note || '')}"
          data-ps="${s.planned_start||''}" data-pe="${s.planned_end||''}" data-ae="${s.actual_end||''}">
          Изменить
        </button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('stages-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="edit-stage"]');
  if (!btn) return;
  activeStageId    = btn.dataset.id;
  activeStageIsVor = btn.dataset.isVor === '1';

  const f = document.getElementById('edit-stage-form');
  document.getElementById('edit-stage-name').value = btn.dataset.name;
  document.getElementById('edit-stage-name').readOnly = activeStageIsVor;

  document.getElementById('edit-stage-regular').style.display = activeStageIsVor ? 'none' : '';
  document.getElementById('edit-stage-vor').style.display     = activeStageIsVor ? '' : 'none';

  if (activeStageIsVor) {
    document.getElementById('edit-stage-status-vor').value  = btn.dataset.status;
    document.getElementById('edit-stage-planned-val').value = btn.dataset.plannedValue;
    document.getElementById('edit-stage-unit').value        = btn.dataset.unit;
    f.actual_value.value  = btn.dataset.actualValue;
    f.planned_date.value  = btn.dataset.plannedDate;
    f.actual_date.value   = btn.dataset.actualDate;
    f.note.value          = btn.dataset.note;
    updateNoteRequired();
    document.getElementById('edit-stage-status-vor').addEventListener('change', updateNoteRequired);
  } else {
    document.getElementById('edit-stage-status-regular').value = btn.dataset.status;
    f.planned_start.value = btn.dataset.ps;
    f.planned_end.value   = btn.dataset.pe;
    f.actual_end.value    = btn.dataset.ae;
  }
  await loadStageWriteoffPanel(btn.dataset.id, activeProjectId);
  openModal('modal-edit-stage');
});

function updateNoteRequired() {
  const isNotDone = document.getElementById('edit-stage-status-vor').value === 'not_done';
  document.getElementById('edit-stage-note-required').style.display = isNotDone ? '' : 'none';
}

document.getElementById('btn-add-stage').addEventListener('click', () => {
  document.getElementById('add-stage-form').reset();
  openModal('modal-add-stage');
});

document.getElementById('add-stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.order_num = parseInt(body.order_num) || 0;
  if (!body.planned_start) delete body.planned_start;
  if (!body.planned_end)   delete body.planned_end;

  const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/stages`, body);
  if (ok) {
    showToast('Этап добавлен', 'success');
    closeModal('modal-add-stage');
    loadStages(activeProjectId);
  } else showToast(data.error, 'error');
});

document.getElementById('edit-stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  let body = {};

  if (activeStageIsVor) {
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
  } else {
    body.name = document.getElementById('edit-stage-name').value;
    body.status = document.getElementById('edit-stage-status-regular').value;
    const plannedStart = fd.get('planned_start');
    const plannedEnd = fd.get('planned_end');
    const actualEnd = fd.get('actual_end');

    if (plannedStart) body.planned_start = plannedStart;
    if (plannedEnd) body.planned_end = plannedEnd;
    if (actualEnd) body.actual_end = actualEnd;
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
  if (!specs.length) {
    container.innerHTML = '<div style="color:var(--muted)">Ведомость пуста. Снабженец ещё не отправил материалы.</div>';
    updateSpecBulkActions();
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <div style="position:sticky;top:0;z-index:3;background:var(--bg);border-bottom:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:42% 14% 14% 14% 16%;gap:0;align-items:center">
          <div style="padding:.75rem 1rem;color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em">Материал</div>
          <div style="padding:.75rem 1rem;color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;text-align:right">Нужно</div>
          <div style="padding:.75rem 1rem;color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;text-align:right">Поступило</div>
          <div style="padding:.75rem 1rem;color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;text-align:right">Осталось</div>
          <div style="padding:.75rem 1rem;color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em">Статус</div>
        </div>
      </div>
      <table>
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
                    <button class="btn btn-sm" style="font-size:.75rem;background:var(--success);color:#000;border:none"
                      data-action="approve-spec" data-id="${s.id}" data-name="${escHtml(s.material_name)}">
                      ✓
                    </button>
                    <button class="btn btn-sm" style="font-size:.75rem;color:var(--danger);border:1px solid var(--border);background:transparent"
                      data-action="reject-spec" data-id="${s.id}" data-name="${escHtml(s.material_name)}">
                      ✕
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
  if (!e.target.classList.contains('spec-approve-checkbox')) return;
  updateSpecBulkActions();
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

  const btnGenerate = document.getElementById('btn-generate-stages');
  const btnAdd      = document.getElementById('btn-add-work-spec');
  const btnBatch    = document.getElementById('btn-batch-work-specs');

  btnGenerate.style.display = (!generated && data.data.length) ? '' : 'none';
  btnAdd.style.display      = generated ? 'none' : '';
  btnBatch.style.display    = generated ? 'none' : '';

  const specs = data.data;
  if (!specs.length) {
    container.innerHTML = '<div style="color:var(--muted)">Позиций нет. Добавьте объёмы работ.</div>';
    return;
  }

  const readonly = generated
    ? '<div style="color:var(--muted);font-size:.82rem;margin-bottom:.75rem">ВОР заблокирован — этапы уже сформированы.</div>'
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
  document.getElementById('add-work-spec-form').reset();
  openModal('modal-add-work-spec');
});

document.getElementById('add-work-spec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    work_name: fd.get('work_name'),
    quantity:  parseFloat(fd.get('quantity')),
  };
  if (fd.get('unit')) body.unit = fd.get('unit');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/foreman/projects/${activeProjectId}/work-specs`, body);
  btn.disabled = false;
  if (ok) {
    showToast('Позиция добавлена', 'success');
    closeModal('modal-add-work-spec');
    loadWorkSpecs(activeProjectId);
  } else showToast(data.error, 'error');
});

// ─── Массовое добавление ВОР (batch modal) ────────────────────
const BATCH_UNITS = ['шт', 'м', 'м²', 'км', 'компл', 'рул', 'кг', 'т', 'л'];
let batchSaveCallback = null;

function batchUnitOptions() {
  return '<option value="">—</option>' +
    BATCH_UNITS.map(u => `<option value="${u}">${escHtml(u)}</option>`).join('');
}

function addBatchRow() {
  const tbody = document.getElementById('batch-tbody');
  const rowNum = tbody.querySelectorAll('tr').length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:.3rem .5rem;color:var(--muted);font-size:.8rem;text-align:center">${rowNum}</td>
    <td style="padding:.2rem .3rem">
      <input type="text" class="batch-cell batch-name" placeholder="Наименование работы"
        style="width:100%;min-width:200px;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .55rem;font-size:.84rem;font-family:inherit;box-sizing:border-box">
    </td>
    <td style="padding:.2rem .3rem">
      <select class="batch-cell batch-unit"
        style="width:100%;background:var(--bg2);color:var(--text);
               border:1px solid var(--border);border-radius:4px;padding:.35rem .4rem;font-size:.84rem;font-family:inherit">
        ${batchUnitOptions()}
      </select>
    </td>
    <td style="padding:.2rem .3rem">
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
    if (tr.querySelector('.batch-name').value.trim() && tr.querySelector('.batch-qty').value) filled++;
  });
  const s = filled % 10 === 1 && filled % 100 !== 11 ? 'позиция' : filled % 10 >= 2 && filled % 10 <= 4 && (filled % 100 < 10 || filled % 100 >= 20) ? 'позиции' : 'позиций';
  document.getElementById('batch-counter').textContent = `${filled} ${s} заполнено`;
}

function openBatchModal(projectName, type, namePlaceholder, saveCallback) {
  document.getElementById('batch-modal-title').textContent = `Массовое добавление — ${type}`;
  document.getElementById('batch-modal-subtitle').textContent = projectName;
  batchSaveCallback = saveCallback;

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
  const cells = [...document.getElementById('modal-batch').querySelectorAll('.batch-cell')];
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
    if (name && qty > 0) items.push({ work_name: name, unit: unit || undefined, quantity: qty });
  });
  if (!items.length) { showToast('Заполните хотя бы одну позицию', 'error'); return; }

  const btn = document.getElementById('btn-batch-save');
  btn.disabled = true; btn.textContent = 'Сохранение...';
  if (batchSaveCallback) await batchSaveCallback(items);
  btn.disabled = false; btn.textContent = 'Сохранить в проект';
});

document.getElementById('btn-batch-work-specs').addEventListener('click', () => {
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

// ─── Склад объекта (вкладка в модалке) ───────────────────────
async function loadProjectWarehouse(id) {
  const tbody = document.querySelector('#modal-warehouse-table tbody');
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

document.getElementById('modal-warehouse-table').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="writeoff"]');
  if (!btn) return;
  activeWarehouseId = btn.dataset.id;
  activeWriteoffProjectId = activeProjectId;
  document.getElementById('writeoff-item-info').innerHTML =
    `<strong>${escHtml(btn.dataset.name)}</strong> · Доступно: <strong>${btn.dataset.available} ${escHtml(btn.dataset.unit)}</strong>`;
  document.getElementById('writeoff-form').reset();
  populateWriteoffStages(activeProjectId).then(() => openModal('modal-writeoff'));
});

// ─── Документы (вкладка в модалке) ────────────────────────────
async function loadProjectDocs(id) {
  const container = document.getElementById('project-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

// ─── Заявки МТР (секция сайдбара) ────────────────────────────
async function loadMtrAll() {
  if (!projectsList.length) await loadProjects();

  const sel = document.getElementById('mtr-project-select');
  sel.innerHTML = projectsList.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const tbody = document.querySelector('#mtr-table tbody');
  tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Загрузка...</td></tr>';

  const allRows = [];
  for (const p of projectsList) {
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${p.id}/mtr-requests`);
    if (ok) data.data.forEach(r => allRows.push({ ...r, project_name: p.name }));
  }

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Заявок нет</td></tr>';
    return;
  }
  tbody.innerHTML = allRows.map(r => `
    <tr>
      <td>
        <strong>${escHtml(r.material_name)}</strong>
        <div style="color:var(--muted);font-size:.78rem">${escHtml(r.project_name)}</div>
        ${r.notes ? `<div style="color:var(--muted);font-size:.8rem">${escHtml(r.notes)}</div>` : ''}
      </td>
      <td>${r.quantity} ${escHtml(r.unit || '')}</td>
      <td style="color:var(--muted);font-size:.85rem">${escHtml(r.stage_name || '—')}</td>
      <td>${badge(r.status)}</td>
      <td style="color:var(--muted);font-size:.85rem">${formatDate(r.created_at)}</td>
    </tr>
  `).join('');
}

document.getElementById('btn-create-mtr').addEventListener('click', async () => {
  if (!projectsList.length) await loadProjects();
  const sel = document.getElementById('mtr-project-select');
  sel.innerHTML = projectsList.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  await updateMtrStages();
  document.getElementById('mtr-form').reset();
  openModal('modal-mtr');
});

document.getElementById('mtr-project-select').addEventListener('change', updateMtrStages);

async function updateMtrStages() {
  const projectId = document.getElementById('mtr-project-select').value;
  if (!projectId) return;
  const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/stages`);
  const sel = document.getElementById('mtr-stage-select');
  sel.innerHTML = '<option value="">— без этапа —</option>';
  if (ok) sel.innerHTML += data.data.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

document.getElementById('mtr-form').addEventListener('submit', async (e) => {
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
    if (document.getElementById('section-mtr').classList.contains('active')) loadMtrAll();
  } else showToast(data.error, 'error');
});

// ─── Склад (секция сайдбара — все проекты) ────────────────────
async function loadWarehouseAll() {
  if (!projectsList.length) await loadProjects();
  const tbody = document.querySelector('#warehouse-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Загрузка...</td></tr>';

  const allRows = [];
  for (const p of projectsList) {
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${p.id}/warehouse`);
    if (ok) data.data.forEach(r => allRows.push({ ...r, project_name: p.name, project_id: p.id }));
  }

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Склад пуст</td></tr>';
    return;
  }
  tbody.innerHTML = allRows.map(r => `
    <tr>
      <td>
        <strong>${escHtml(r.material_name)}</strong>
        <div style="color:var(--muted);font-size:.78rem">${escHtml(r.project_name)}</div>
      </td>
      <td>${escHtml(r.unit || '—')}</td>
      <td>${r.qty_total}</td>
      <td>${r.qty_used}</td>
      <td style="font-weight:600;color:${Number(r.qty_balance) > 0 ? 'var(--success)' : Number(r.qty_balance) < 0 ? 'var(--danger)' : 'var(--muted)'}">
        ${r.qty_balance}
      </td>
      <td style="color:var(--muted);font-size:.8rem">${escHtml(SOURCE_LABELS[r.source] || r.source)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-action="writeoff"
          data-id="${r.id}" data-name="${escHtml(r.material_name)}"
          data-unit="${escHtml(r.unit||'')}" data-available="${r.qty_balance}"
          data-project-id="${r.project_id || ''}">
          Списать
        </button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('warehouse-table').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="writeoff"]');
  if (!btn) return;
  activeWarehouseId = btn.dataset.id;
  activeWriteoffProjectId = btn.dataset.projectId;
  document.getElementById('writeoff-item-info').innerHTML =
    `<strong>${escHtml(btn.dataset.name)}</strong> · Доступно: <strong>${btn.dataset.available} ${escHtml(btn.dataset.unit)}</strong>`;
  document.getElementById('writeoff-form').reset();
  populateWriteoffStages(btn.dataset.projectId).then(() => openModal('modal-writeoff'));
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
      loadWarehouseAll();
    }
  } else showToast(data.error, 'error');
});

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
        <a href="${photo.url}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">
          <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg2)">
            <img src="${photo.url}" alt="${escHtml(photo.description || 'Фото этапа')}"
              style="width:100%;height:120px;object-fit:cover;display:block">
            <div style="padding:.55rem .6rem">
              <div style="font-size:.75rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(photo.description || 'Без описания')}</div>
              <div style="font-size:.72rem;color:var(--muted);margin-top:.2rem">${formatDate(photo.uploaded_at)}</div>
            </div>
          </div>
        </a>
      `).join('')}
    </div>
  `;
}

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

// ─── Присоединиться по коду ───────────────────────────────────
document.getElementById('btn-join-project').addEventListener('click', () => {
  document.getElementById('join-form').reset();
  openModal('modal-join');
});

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get('code').toUpperCase();
  const { ok, data } = await apiRequest('POST', '/api/foreman/projects/join', { code });
  if (ok) {
    showToast(`Вы добавлены в проект «${data.data.name}»`, 'success');
    closeModal('modal-join');
    loadProjects();
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

init();
