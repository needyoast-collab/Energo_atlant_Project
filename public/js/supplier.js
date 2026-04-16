const SOURCE_LABELS = { company: 'Общий склад', purchase: 'Закупка', customer: 'От заказчика' };
const SPEC_STATUS_LABELS = {
  draft: 'Черновик', pending_approval: 'На согласовании',
  approved: 'Согласовано', rejected: 'Отклонено',
};

let currentUser    = null;
let projectsList   = [];
let activeMtrId    = null;
let activeModalProjectId = null;
let activeGeneralItemId  = null;
let activeSpecId         = null;

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('supplier');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  await loadProjects();
  renderProjectCards();
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'projects')         renderProjectCards();
  if (section === 'mtr')              loadMtrAll();
  if (section === 'general-warehouse') loadGeneralWarehouse();
});

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/supplier/projects');
  if (!ok) return;
  projectsList = data.data;

  const filterSel = document.getElementById('mtr-project-filter');
  filterSel.innerHTML = '<option value="">Все проекты</option>' +
    projectsList.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const transferSel = document.getElementById('transfer-project-select');
  transferSel.innerHTML = '<option value="">— выберите проект —</option>' +
    projectsList.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
}

function renderProjectCards() {
  const container = document.getElementById('projects-list');
  if (!container) return;
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

document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  openProjectModal(card.dataset.id);
});

async function openProjectModal(id) {
  activeModalProjectId = id;
  const project = projectsList.find(p => p.id == id);
  if (!project) return;

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML =
    `${badge(project.status)} <span style="margin-left:.5rem">${escHtml(project.code)}</span>` +
    (project.address ? ` · 📍 ${escHtml(project.address)}` : '');

  document.getElementById('sup-warehouse-export').href =
    `/api/supplier/projects/${id}/warehouse/export`;

  try {
    switchSupTab('warehouse');
  } catch(err) { /* tab уже активен */ }
  openModal('modal-project');
}

// ─── Вкладки проекта ─────────────────────────────────────────
const SUP_TABS = ['warehouse', 'specs', 'docs'];

function switchSupTab(tab) {
  SUP_TABS.forEach(t => {
    document.getElementById(`sup-tab-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`sup-tab-btn-${t}`).className =
      t === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  });
  if (tab === 'warehouse') loadSupWarehouse(activeModalProjectId);
  if (tab === 'specs')     loadSupSpecs(activeModalProjectId);
  if (tab === 'docs')      loadSupModalDocs(activeModalProjectId);
}

document.querySelectorAll('[data-suptab]').forEach(btn => {
  btn.addEventListener('click', () => switchSupTab(btn.dataset.suptab));
});

// ─── Склад объекта (в модалке) ────────────────────────────────
async function loadSupWarehouse(id) {
  const tbody = document.querySelector('#sup-warehouse-table tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/warehouse`);
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
      <td style="color:var(--muted);font-size:.8rem">${escHtml(SOURCE_LABELS[r.source] || r.source)}</td>
    </tr>
  `).join('');
}

document.getElementById('btn-add-project-warehouse').addEventListener('click', () => {
  document.getElementById('add-warehouse-form').reset();
  openModal('modal-add-warehouse');
});

document.getElementById('add-warehouse-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    material_name: fd.get('material_name'),
    unit:          fd.get('unit') || undefined,
    qty_total:     parseFloat(fd.get('qty_total')) || 0,
    source:        fd.get('source'),
  };
  if (fd.get('notes')) body.notes = fd.get('notes');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/supplier/projects/${activeModalProjectId}/warehouse`, body);
  btn.disabled = false;
  if (ok) {
    showToast('Материал добавлен на склад', 'success');
    closeModal('modal-add-warehouse');
    loadSupWarehouse(activeModalProjectId);
  } else showToast(data.error, 'error');
});

// ─── Ведомость (в модалке) ────────────────────────────────────
async function loadSupSpecs(id) {
  const container = document.getElementById('sup-specs-list');
  container.innerHTML = '<div style="color:var(--muted)">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/specs`);
  if (!ok) { container.innerHTML = '<div style="color:var(--danger)">Ошибка загрузки</div>'; return; }

  const specs = data.data;
  const hasDraft = specs.some(s => s.status === 'draft');
  document.getElementById('btn-submit-specs').disabled = !hasDraft;
  document.getElementById('btn-submit-specs').style.opacity = hasDraft ? '1' : '.4';

  if (!specs.length) {
    container.innerHTML = '<div style="color:var(--muted)">Позиций нет. Добавьте материалы.</div>';
    return;
  }

  container.innerHTML = specs.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.55rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:500;font-size:.9rem">${escHtml(s.material_name)}</div>
        <div style="color:var(--muted);font-size:.78rem">
          ${s.quantity} ${escHtml(s.unit || '')} · ${escHtml(SPEC_STATUS_LABELS[s.status] || s.status)}
          ${s.rejection_note ? ` · <span style="color:var(--danger)">${escHtml(s.rejection_note)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:.35rem;flex-shrink:0;margin-left:.5rem">
        ${s.status === 'draft' ? `
          <button class="btn btn-outline btn-sm" style="font-size:.75rem"
            data-action="edit-spec" data-id="${s.id}"
            data-name="${escHtml(s.material_name)}" data-unit="${escHtml(s.unit||'')}" data-qty="${s.quantity}">
            Изм.
          </button>
          <button class="btn btn-sm" style="font-size:.75rem;color:var(--danger);border:1px solid var(--border);background:transparent"
            data-action="delete-spec" data-id="${s.id}">
            ✕
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

document.getElementById('sup-specs-list').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-action="edit-spec"]');
  if (editBtn) {
    activeSpecId = editBtn.dataset.id;
    document.getElementById('modal-spec-title').textContent = 'Редактировать позицию';
    const form = document.getElementById('spec-form');
    form.reset();
    form.querySelector('[name=spec_id]').value = activeSpecId;
    form.querySelector('[name=material_name]').value = editBtn.dataset.name;
    form.querySelector('[name=unit]').value = editBtn.dataset.unit;
    form.querySelector('[name=quantity]').value = editBtn.dataset.qty;
    openModal('modal-add-spec');
    return;
  }

  const delBtn = e.target.closest('[data-action="delete-spec"]');
  if (delBtn) {
    if (!confirm('Удалить позицию?')) return;
    const { ok, data } = await apiRequest('DELETE', `/api/supplier/specs/${delBtn.dataset.id}`);
    if (ok) { showToast('Удалено', 'success'); loadSupSpecs(activeModalProjectId); }
    else showToast(data.error, 'error');
  }
});

document.getElementById('btn-add-spec').addEventListener('click', () => {
  activeSpecId = null;
  document.getElementById('modal-spec-title').textContent = 'Добавить позицию';
  document.getElementById('spec-form').reset();
  openModal('modal-add-spec');
});

document.getElementById('spec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const specId = fd.get('spec_id');
  const body = {
    material_name: fd.get('material_name'),
    unit:          fd.get('unit') || undefined,
    quantity:      parseFloat(fd.get('quantity')),
  };

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  let ok, data;
  if (specId) {
    ({ ok, data } = await apiRequest('PUT', `/api/supplier/specs/${specId}`, body));
  } else {
    ({ ok, data } = await apiRequest('POST', `/api/supplier/projects/${activeModalProjectId}/specs`, body));
  }
  btn.disabled = false;

  if (ok) {
    showToast(specId ? 'Позиция обновлена' : 'Позиция добавлена', 'success');
    closeModal('modal-add-spec');
    loadSupSpecs(activeModalProjectId);
  } else showToast(data.error, 'error');
});

document.getElementById('btn-submit-specs').addEventListener('click', async () => {
  if (!confirm('Отправить ведомость на согласование прорабу?')) return;
  const { ok, data } = await apiRequest('POST', `/api/supplier/projects/${activeModalProjectId}/specs/submit`);
  if (ok) {
    showToast(`Отправлено (${data.data.submitted} позиций)`, 'success');
    loadSupSpecs(activeModalProjectId);
  } else showToast(data.error, 'error');
});

// ─── Массовое добавление ВОМ (batch modal) ────────────────────
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
      <input type="text" class="batch-cell batch-name" placeholder="Наименование материала"
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

  // Обновить placeholder наименования
  tbody.querySelectorAll('.batch-name').forEach(el => { el.placeholder = namePlaceholder || 'Наименование'; });

  updateBatchCounter();
  openModal('modal-batch');
  tbody.querySelector('.batch-name').focus();
}

// Tab / Enter → следующая ячейка или новая строка
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

// Подсветка активной ячейки янтарём
document.getElementById('modal-batch').addEventListener('focusin', e => {
  if (e.target.classList.contains('batch-cell')) e.target.style.borderColor = '#F5A623';
});
document.getElementById('modal-batch').addEventListener('focusout', e => {
  if (e.target.classList.contains('batch-cell')) e.target.style.borderColor = 'var(--border)';
});

// Счётчик
document.getElementById('batch-tbody').addEventListener('input', updateBatchCounter);

// Вставка из буфера (TSV — формат Excel)
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
    if (name && qty > 0) items.push({ material_name: name, unit: unit || undefined, quantity: qty });
  });
  if (!items.length) { showToast('Заполните хотя бы одну позицию', 'error'); return; }

  const btn = document.getElementById('btn-batch-save');
  btn.disabled = true; btn.textContent = 'Сохранение...';
  if (batchSaveCallback) await batchSaveCallback(items);
  btn.disabled = false; btn.textContent = 'Сохранить в проект';
});

document.getElementById('btn-batch-specs').addEventListener('click', () => {
  const project = projectsList.find(p => p.id == activeModalProjectId);
  openBatchModal(project?.name || '', 'ВОМ', 'Наименование материала', async (items) => {
    const { ok, data } = await apiRequest('POST', `/api/supplier/projects/${activeModalProjectId}/specs/batch`, { items });
    if (ok) {
      showToast(`Добавлено позиций: ${data.data.inserted}`, 'success');
      closeModal('modal-batch');
      loadSupSpecs(activeModalProjectId);
    } else showToast(data.error, 'error');
  });
});

// ─── Документы (в модалке) ────────────────────────────────────
async function loadSupModalDocs(id) {
  const container = document.getElementById('sup-modal-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

// ─── Общий склад ─────────────────────────────────────────────
async function loadGeneralWarehouse() {
  const tbody = document.querySelector('#general-warehouse-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', '/api/supplier/general-warehouse');
  if (!ok) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--danger)">Ошибка загрузки</td></tr>'; return; }
  if (!data.data.length) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Склад пуст</td></tr>'; return; }

  tbody.innerHTML = data.data.map(r => {
    const available = Number(r.qty_total) - Number(r.qty_reserved);
    return `
      <tr>
        <td><strong>${escHtml(r.material_name)}</strong></td>
        <td>${escHtml(r.unit || '—')}</td>
        <td>${r.qty_total}</td>
        <td>${r.qty_reserved}</td>
        <td style="font-weight:600;color:${available > 0 ? 'var(--success)' : 'var(--muted)'}">${available}</td>
        <td style="color:var(--muted);font-size:.8rem">${escHtml(r.notes || '—')}</td>
        <td>
          <button class="btn btn-outline btn-sm" style="font-size:.78rem"
            data-action="transfer" data-id="${r.id}"
            data-name="${escHtml(r.material_name)}" data-unit="${escHtml(r.unit||'')}"
            data-available="${available}">
            Перевести
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-add-general').addEventListener('click', () => {
  document.getElementById('add-general-form').reset();
  openModal('modal-add-general');
});

document.getElementById('add-general-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    material_name: fd.get('material_name'),
    unit:          fd.get('unit') || undefined,
    qty_total:     parseFloat(fd.get('qty_total')) || 0,
  };
  if (fd.get('notes')) body.notes = fd.get('notes');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', '/api/supplier/general-warehouse', body);
  btn.disabled = false;
  if (ok) {
    showToast('Добавлено на общий склад', 'success');
    closeModal('modal-add-general');
    loadGeneralWarehouse();
  } else showToast(data.error, 'error');
});

document.getElementById('general-warehouse-table').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="transfer"]');
  if (!btn) return;
  activeGeneralItemId = btn.dataset.id;
  document.getElementById('transfer-item-info').innerHTML =
    `<strong>${escHtml(btn.dataset.name)}</strong> · Доступно: <strong>${btn.dataset.available} ${escHtml(btn.dataset.unit)}</strong>`;
  document.querySelector('#transfer-form [name=unit]').value = btn.dataset.unit;
  document.querySelector('#transfer-form [name=quantity]').value = '';
  document.getElementById('transfer-project-select').value = '';
  openModal('modal-transfer');
});

document.getElementById('transfer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    project_id: parseInt(fd.get('project_id')),
    quantity:   parseFloat(fd.get('quantity')),
    unit:       fd.get('unit') || undefined,
  };
  if (fd.get('notes')) body.notes = fd.get('notes');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/supplier/general-warehouse/${activeGeneralItemId}/transfer`, body);
  btn.disabled = false;
  if (ok) {
    showToast('Материал переведён на склад объекта', 'success');
    closeModal('modal-transfer');
    loadGeneralWarehouse();
  } else showToast(data.error, 'error');
});

// ─── Заявки МТР ──────────────────────────────────────────────
async function loadMtrAll(filterProjectId = '') {
  const tbody = document.querySelector('#mtr-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Загрузка...</td></tr>';

  const projects = filterProjectId
    ? projectsList.filter(p => p.id == filterProjectId)
    : projectsList;

  const allRows = [];
  for (const p of projects) {
    const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${p.id}/mtr-requests`);
    if (ok) data.data.forEach(r => allRows.push({ ...r, project_name: p.name }));
  }

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">Заявок нет</td></tr>';
    return;
  }

  allRows.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  tbody.innerHTML = allRows.map(r => `
    <tr>
      <td>
        <strong>${escHtml(r.material_name)}</strong>
        <div style="color:var(--muted);font-size:.78rem">${escHtml(r.project_name)}</div>
        ${r.notes ? `<div style="color:var(--muted);font-size:.78rem">${escHtml(r.notes)}</div>` : ''}
      </td>
      <td>${r.quantity} ${escHtml(r.unit || '')}</td>
      <td style="color:var(--muted);font-size:.85rem">${escHtml(r.foreman_name || '—')}</td>
      <td style="color:var(--muted);font-size:.85rem">${escHtml(r.stage_name || '—')}</td>
      <td>${badge(r.status)}</td>
      <td style="color:var(--muted);font-size:.85rem">${formatDate(r.created_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-action="open-mtr"
          data-id="${r.id}" data-status="${r.status}"
          data-name="${escHtml(r.material_name)}" data-qty="${r.quantity}"
          data-unit="${escHtml(r.unit||'')}" data-notes="${escHtml(r.notes||'')}">
          Обработать
        </button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('mtr-project-filter').addEventListener('change', (e) => {
  loadMtrAll(e.target.value);
});

document.getElementById('mtr-table').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="open-mtr"]');
  if (!btn) return;
  activeMtrId = btn.dataset.id;
  document.getElementById('mtr-info').innerHTML = `
    <p><strong>${escHtml(btn.dataset.name)}</strong></p>
    <p style="color:var(--muted);font-size:.9rem">Количество: ${btn.dataset.qty} ${escHtml(btn.dataset.unit)}</p>
    ${btn.dataset.notes ? `<p style="color:var(--muted);font-size:.85rem">${escHtml(btn.dataset.notes)}</p>` : ''}
  `;
  document.querySelector('#mtr-form [name=status]').value =
    btn.dataset.status !== 'pending' ? btn.dataset.status : 'approved';
  document.querySelector('#mtr-form [name=notes]').value = '';
  openModal('modal-mtr');
});

document.getElementById('mtr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { status: fd.get('status') };
  if (fd.get('notes')) body.notes = fd.get('notes');

  const { ok, data } = await apiRequest('PUT', `/api/supplier/mtr-requests/${activeMtrId}`, body);
  if (ok) {
    showToast('Статус заявки обновлён', 'success');
    closeModal('modal-mtr');
    loadMtrAll(document.getElementById('mtr-project-filter').value);
  } else showToast(data.error, 'error');
});

// ─── Войти по коду ───────────────────────────────────────────
document.getElementById('btn-join-project').addEventListener('click', () => {
  document.getElementById('join-form').reset();
  openModal('modal-join');
});
document.getElementById('btn-join-project-proj').addEventListener('click', () => {
  document.getElementById('join-form').reset();
  openModal('modal-join');
});

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get('code').toUpperCase();
  const { ok, data } = await apiRequest('POST', '/api/supplier/projects/join', { code });
  if (ok) {
    showToast(`Вы добавлены в проект «${data.data.name}»`, 'success');
    closeModal('modal-join');
    await loadProjects();
    renderProjectCards();
  } else showToast(data.error, 'error');
});

init();
