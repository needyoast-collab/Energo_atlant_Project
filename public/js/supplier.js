const SOURCE_LABELS = { company: 'Общий склад', purchase: 'Закупка', customer: 'От заказчика' };
const SPEC_STATUS_LABELS = {
  draft: 'Черновик', pending_approval: 'На согласовании',
  approved: 'Согласовано', rejected: 'Отклонено',
};

function qtyStateClass(value) {
  const num = Number(value);
  if (num > 0) return 'text-success';
  if (num < 0) return 'text-danger';
  return 'text-muted';
}

function isVisible(el) {
  return !!el && !el.classList.contains('is-hidden');
}

let currentUser    = null;
let projectsList   = [];
let activeMtrId    = null;
let activeModalProjectId = null;
let activeGeneralItemId  = null;
let activeEditGeneralId  = null;
let activeSpecId         = null;
let activeFulfillSpecId  = null;
let activeStockTab       = 'general';
let generalWarehouseCache = null;
let currentSupSpecs = [];

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.SUPPLIER);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    await loadProjects();
    renderProjectCards();
  } finally {
    window.hidePreloader?.();
  }
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'projects')         renderProjectCards();
  if (section === 'mtr')              loadMtrAll();
  if (section === 'stock') {
    switchStockTab(activeStockTab);
  }
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
    container.innerHTML = `<div class="card empty-card">
      Нет проектов. Войдите по коду от менеджера.</div>`;
    return;
  }
  container.innerHTML = projectsList.map(p => `
    <div class="card supplier-project-card" data-action="open-project" data-id="${p.id}">
      <div class="supplier-card-head">
        <div class="card-title supplier-card-title">${escHtml(p.name)}</div>
        ${badge(p.status)}
      </div>
      <div class="supplier-card-meta">${escHtml(p.code)}</div>
      ${p.address ? `<div class="supplier-card-meta">📍 ${escHtml(p.address)}</div>` : ''}
      ${p.manager_name ? `<div class="supplier-card-meta">Менеджер: ${escHtml(p.manager_name)}</div>` : ''}
    </div>
  `).join('');
}

function renderStockProjectsTable() {
  const tbody = document.querySelector('#stock-projects-table tbody');
  if (!tbody) return;
  if (!projectsList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Нет проектов, привязанных к снабженцу.</td></tr>';
    return;
  }

  tbody.innerHTML = projectsList.map(p => `
    <tr>
      <td class="table-cell-muted-sm">${escHtml(p.code)}</td>
      <td class="table-cell-strong">${escHtml(p.name)}</td>
      <td>${badge(p.status)}</td>
      <td class="table-cell-muted-sm">${escHtml(p.address || '—')}</td>
      <td class="table-cell-right">
        <button class="btn btn-outline btn-sm" data-action="open-project-stock" data-id="${p.id}">
          Открыть склад
        </button>
      </td>
    </tr>
  `).join('');
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (card) {
    openProjectModal(card.dataset.id);
    return;
  }

  const stockCardBtn = e.target.closest('[data-action="open-project-stock"]');
  if (stockCardBtn) {
    openProjectModal(stockCardBtn.dataset.id, { warehouseOnly: true });
  }
});

function switchStockTab(tab) {
  activeStockTab = tab;
  document.querySelectorAll('[data-stock-tab]').forEach((btn) => {
    btn.className = btn.dataset.stockTab === tab ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  });
  const general = document.getElementById('stock-tab-general');
  const projects = document.getElementById('stock-tab-projects');
  if (general) general.classList.toggle('is-hidden', tab !== 'general');
  if (projects) projects.classList.toggle('is-hidden', tab !== 'projects');
  if (tab === 'general') loadGeneralWarehouse();
  if (tab === 'projects') renderStockProjectsTable();
}

document.querySelectorAll('[data-stock-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchStockTab(btn.dataset.stockTab));
});

async function openProjectModal(id, options = {}) {
  const { warehouseOnly = false } = options;
  activeModalProjectId = id;
  const project = projectsList.find(p => p.id == id);
  if (!project) return;

  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML =
    `${badge(project.status)} <span class="supplier-modal-meta-code">${escHtml(project.code)}</span>` +
    (project.address ? ` · 📍 ${escHtml(project.address)}` : '');

  document.getElementById('sup-warehouse-export').href =
    `/api/supplier/projects/${id}/warehouse/export`;

  const tabs = document.getElementById('sup-project-tabs');
  if (tabs) tabs.classList.toggle('is-hidden', warehouseOnly);

  openModal('modal-project');

  try {
    switchSupTab('warehouse');
  } catch(err) { /* tab уже активен */ }

  if (warehouseOnly) {
    document.getElementById('sup-tab-warehouse').classList.remove('is-hidden');
    document.getElementById('sup-tab-specs').classList.add('is-hidden');
    document.getElementById('sup-tab-docs').classList.add('is-hidden');
  }
}

// ─── Вкладки проекта ─────────────────────────────────────────
const SUP_TABS = ['warehouse', 'specs', 'docs'];

function switchSupTab(tab) {
  SUP_TABS.forEach(t => {
    document.getElementById(`sup-tab-${t}`).classList.toggle('is-hidden', t !== tab);
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
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/warehouse`);
  if (!ok) { tbody.innerHTML = '<tr><td colspan="6" class="table-error">Ошибка загрузки</td></tr>'; return; }
  if (!data.data.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Склад пуст</td></tr>'; return; }

  tbody.innerHTML = data.data.map(r => `
    <tr>
      <td><strong>${escHtml(r.material_name)}</strong></td>
      <td>${escHtml(r.unit || '—')}</td>
      <td>${r.qty_total}</td>
      <td>${r.qty_used}</td>
      <td class="table-cell-strong ${qtyStateClass(r.qty_balance)}">
        ${r.qty_balance}
      </td>
      <td class="table-cell-muted-xs">${escHtml(SOURCE_LABELS[r.source] || r.source)}</td>
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
  container.innerHTML = '<div class="text-muted">Загрузка...</div>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/specs`);
  if (!ok) { container.innerHTML = '<div class="text-danger">Ошибка загрузки</div>'; return; }

  const specs = data.data;
  currentSupSpecs = specs;
  const hasDraft = specs.some(s => s.status === 'draft');
  document.getElementById('btn-submit-specs').disabled = !hasDraft;
  updateFulfillSelectedButton();

  if (!specs.length) {
    container.innerHTML = '<div class="text-muted">Позиций нет. Добавьте материалы.</div>';
    return;
  }

  const getSupplyState = (spec) => {
    const supplied = Number(spec.supplied_qty || 0);
    const remaining = Number(spec.remaining_qty || 0);
    if (remaining <= 0 && supplied > 0) return { label: 'Обеспечено', cls: 'text-success' };
    if (supplied > 0) return { label: 'Частично обеспечено', cls: 'text-accent' };
    return { label: 'Не обеспечено', cls: 'text-muted' };
  };

  container.innerHTML = specs.map(s => `
    <div class="supplier-spec-row">
      <div class="supplier-spec-head">
        ${s.status === 'approved' && Number(s.remaining_qty || 0) > 0 ? `
          <label class="supplier-spec-check">
            <input type="checkbox" class="fulfill-spec-checkbox" value="${s.id}" aria-label="Выбрать ${escHtml(s.material_name)}">
          </label>
        ` : '<div class="supplier-spec-check-placeholder"></div>'}
        <div class="supplier-spec-body">
          <div class="supplier-spec-title">${escHtml(s.material_name)}</div>
          <div class="supplier-spec-meta">
            <span>Нужно: <strong>${s.quantity} ${escHtml(s.unit || '')}</strong></span>
            <span>Цена: <strong>${formatMoney(Number(s.unit_price || 0))}</strong></span>
            <span>Обеспечено: <strong>${s.supplied_qty || 0}</strong></span>
            <span>Осталось: <strong>${s.remaining_qty || 0}</strong></span>
          </div>
          ${s.status === 'approved' ? `
            <div class="supplier-spec-supply ${getSupplyState(s).cls}">
              ${getSupplyState(s).label}
            </div>
          ` : ''}
          <div class="supplier-spec-status">
            ${escHtml(SPEC_STATUS_LABELS[s.status] || s.status)}
            ${s.rejection_note ? ` · <span class="text-danger">${escHtml(s.rejection_note)}</span>` : ''}
          </div>
        </div>
        <div class="supplier-spec-actions">
          ${s.status === 'approved' && Number(s.remaining_qty || 0) > 0 ? `
            <button class="btn btn-outline btn-sm supplier-action-btn-sm"
              data-action="fulfill-spec" data-id="${s.id}"
              data-name="${escHtml(s.material_name)}" data-unit="${escHtml(s.unit || '')}"
              data-remaining="${s.remaining_qty}">
              Обеспечить
            </button>
          ` : ''}
          ${s.status === 'draft' ? `
            <button class="btn btn-outline btn-sm supplier-action-btn-sm supplier-action-btn-wide"
              data-action="edit-spec" data-id="${s.id}"
              data-name="${escHtml(s.material_name)}" data-unit="${escHtml(s.unit||'')}" data-qty="${s.quantity}" data-price="${s.unit_price}">
              Изм.
            </button>
            <button class="btn btn-outline btn-sm supplier-action-btn-sm supplier-action-btn-wide supplier-danger-btn"
              data-action="delete-spec" data-id="${s.id}">
              Удалить
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');
  updateFulfillSelectedButton();
}

function getSelectedFulfillSpecs() {
  const ids = [...document.querySelectorAll('.fulfill-spec-checkbox:checked')]
    .map((input) => Number(input.value));
  return currentSupSpecs.filter((spec) => ids.includes(Number(spec.id)));
}

function updateFulfillSelectedButton() {
  const btn = document.getElementById('btn-fulfill-selected-specs');
  if (!btn) return;
  const count = document.querySelectorAll('.fulfill-spec-checkbox:checked').length;
  const hasFulfillable = currentSupSpecs.some((spec) => spec.status === 'approved' && Number(spec.remaining_qty || 0) > 0);
  btn.classList.toggle('is-hidden', !hasFulfillable);
  btn.disabled = count === 0;
  btn.textContent = count ? `Обеспечить выбранные (${count})` : 'Обеспечить выбранные';
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
    form.querySelector('[name=unit_price]').value = editBtn.dataset.price || '0';
    openModal('modal-add-spec');
    return;
  }

  const delBtn = e.target.closest('[data-action="delete-spec"]');
  if (delBtn) {
    if (!confirm('Удалить позицию?')) return;
    const { ok, data } = await apiRequest('DELETE', `/api/supplier/specs/${delBtn.dataset.id}`);
    if (ok) { showToast('Удалено', 'success'); loadSupSpecs(activeModalProjectId); }
    else showToast(data.error, 'error');
    return;
  }

  const fulfillBtn = e.target.closest('[data-action="fulfill-spec"]');
  if (fulfillBtn) {
    activeFulfillSpecId = fulfillBtn.dataset.id;
    document.getElementById('fulfill-spec-info').innerHTML =
      `<strong>${escHtml(fulfillBtn.dataset.name)}</strong> · Осталось обеспечить: <strong>${fulfillBtn.dataset.remaining} ${escHtml(fulfillBtn.dataset.unit || '')}</strong>`;
    const form = document.getElementById('fulfill-spec-form');
    form.reset();
    form.querySelector('[name=quantity]').value = fulfillBtn.dataset.remaining;
    form.querySelector('[name=unit]').value = fulfillBtn.dataset.unit || '';
    const priceInput = form.querySelector('[name=purchase_price]');
    priceInput.value = '';
    document.getElementById('fulfill-spec-source').value = 'company';
    await loadFulfillGeneralItems(fulfillBtn.dataset.name);
    toggleFulfillGeneralWrap();
    openModal('modal-fulfill-spec');
  }
});

document.getElementById('sup-specs-list').addEventListener('change', (e) => {
  if (e.target.classList.contains('fulfill-spec-checkbox')) {
    updateFulfillSelectedButton();
  }
});

function renderFulfillSelectedRows(specs) {
  const tbody = document.getElementById('fulfill-selected-tbody');
  tbody.innerHTML = specs.map((spec) => {
    const remaining = Number(spec.remaining_qty || 0);
    const price = Number(spec.unit_price || 0);
    return `
      <tr data-spec-id="${spec.id}">
        <td>
          <div class="supplier-fulfill-material">${escHtml(spec.material_name)}</div>
          <div class="supplier-fulfill-needed">Нужно: ${spec.quantity} ${escHtml(spec.unit || '')}</div>
        </td>
        <td class="table-cell-right">${remaining} ${escHtml(spec.unit || '')}</td>
        <td>
          <input type="number" class="form-control form-control-sm fulfill-selected-qty" min="0.001" step="0.001" value="${remaining}" max="${remaining}">
        </td>
        <td data-purchase-price-cell>
          <input type="number" class="form-control form-control-sm fulfill-selected-price" min="0" step="0.01" value="${price}">
        </td>
      </tr>
    `;
  }).join('');
}

function toggleFulfillSelectedPriceColumn() {
  const isPurchase = document.getElementById('fulfill-selected-source').value === 'purchase';
  document.querySelectorAll('[data-purchase-price-head], [data-purchase-price-cell]').forEach((el) => {
    el.classList.toggle('is-hidden', !isPurchase);
  });
}

document.getElementById('fulfill-selected-source').addEventListener('change', toggleFulfillSelectedPriceColumn);

document.getElementById('btn-fulfill-selected-specs').addEventListener('click', () => {
  const selected = getSelectedFulfillSpecs();
  if (!selected.length) {
    showToast('Отметьте хотя бы одну позицию', 'error');
    return;
  }
  document.getElementById('fulfill-selected-subtitle').textContent = `Выбрано позиций: ${selected.length}`;
  document.getElementById('fulfill-selected-source').value = 'purchase';
  document.getElementById('fulfill-selected-notes').value = '';
  renderFulfillSelectedRows(selected);
  toggleFulfillSelectedPriceColumn();
  openModal('modal-fulfill-selected');
});

document.getElementById('fulfill-selected-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const source = document.getElementById('fulfill-selected-source').value;
  const notes = document.getElementById('fulfill-selected-notes').value.trim();
  const items = [];

  for (const row of document.querySelectorAll('#fulfill-selected-tbody tr')) {
    const specId = Number(row.dataset.specId);
    const spec = currentSupSpecs.find((item) => Number(item.id) === specId);
    if (!spec) continue;

    const quantity = parseFloat(row.querySelector('.fulfill-selected-qty').value);
    const remaining = Number(spec.remaining_qty || 0);
    if (!quantity || quantity <= 0) {
      showToast(`Укажите количество для «${spec.material_name}»`, 'error');
      return;
    }
    if (quantity > remaining) {
      showToast(`По «${spec.material_name}» осталось обеспечить: ${remaining}`, 'error');
      return;
    }

    const item = { spec_id: specId, quantity };
    if (source === 'purchase') {
      const purchasePrice = parseFloat(row.querySelector('.fulfill-selected-price').value);
      if (Number.isNaN(purchasePrice) || purchasePrice < 0) {
        showToast(`Укажите цену закупки для «${spec.material_name}»`, 'error');
        return;
      }
      item.purchase_price = purchasePrice;
    }
    items.push(item);
  }

  if (!items.length) {
    showToast('Нет выбранных позиций', 'error');
    return;
  }

  const submitBtn = document.querySelector('#modal-fulfill-selected button[type="submit"]');
  submitBtn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/supplier/projects/${activeModalProjectId}/specs/fulfill-batch`, {
    source,
    notes: notes || undefined,
    items,
  });
  submitBtn.disabled = false;

  if (ok) {
    showToast(`Обеспечено позиций: ${data.data.inserted}`, 'success');
    closeModal('modal-fulfill-selected');
    loadSupSpecs(activeModalProjectId);
    if (isVisible(document.getElementById('sup-tab-warehouse'))) {
      loadSupWarehouse(activeModalProjectId);
    }
  } else {
    showToast(data.error, 'error');
  }
});

document.getElementById('btn-add-spec').addEventListener('click', () => {
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

document.getElementById('spec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const specId = fd.get('spec_id');
  const body = {
    material_name: fd.get('material_name'),
    unit:          fd.get('unit') || undefined,
    quantity:      parseFloat(fd.get('quantity')),
    unit_price:    parseFloat(fd.get('unit_price')),
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

async function loadFulfillGeneralItems(materialName) {
  const select = document.getElementById('fulfill-general-item');
  select.innerHTML = '<option value="">— выберите позицию —</option>';

  if (!generalWarehouseCache) {
    const { ok, data } = await apiRequest('GET', '/api/supplier/general-warehouse');
    if (!ok) return;
    generalWarehouseCache = data.data || [];
  }

  const normalized = (materialName || '').trim().toLowerCase();
  const rows = generalWarehouseCache.filter((item) => Number(item.qty_total) - Number(item.qty_reserved || 0) > 0);
  const matched = rows.filter((item) => item.material_name.toLowerCase().includes(normalized));
  const list = matched.length ? matched : rows;

  select.innerHTML += list.map((item) => {
    const available = Number(item.qty_total) - Number(item.qty_reserved || 0);
    return `<option value="${item.id}">${escHtml(item.material_name)} · доступно ${available} ${escHtml(item.unit || '')}</option>`;
  }).join('');
}

function toggleFulfillGeneralWrap() {
  const source = document.getElementById('fulfill-spec-source').value;
  const wrap = document.getElementById('fulfill-general-wrap');
  const purchaseWrap = document.getElementById('fulfill-purchase-price-wrap');
  const select = document.getElementById('fulfill-general-item');
  const priceInput = document.querySelector('#fulfill-spec-form [name=purchase_price]');
  wrap.classList.toggle('is-hidden', source !== 'company');
  purchaseWrap.classList.toggle('is-hidden', source !== 'purchase');
  select.required = source === 'company';
  priceInput.required = source === 'purchase';
}

document.getElementById('fulfill-spec-source').addEventListener('change', toggleFulfillGeneralWrap);

document.getElementById('fulfill-spec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeFulfillSpecId) return;

  const fd = new FormData(e.target);
  const body = {
    source: fd.get('source'),
    quantity: parseFloat(fd.get('quantity')),
  };
  if (fd.get('general_item_id')) body.general_item_id = parseInt(fd.get('general_item_id'), 10);
  if (fd.get('purchase_price')) body.purchase_price = parseFloat(fd.get('purchase_price'));
  if (fd.get('unit')) body.unit = fd.get('unit');
  if (fd.get('notes')) body.notes = fd.get('notes');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', `/api/supplier/specs/${activeFulfillSpecId}/fulfill`, body);
  btn.disabled = false;
  if (ok) {
    showToast('Материал поступил на склад объекта', 'success');
    closeModal('modal-fulfill-spec');
    loadSupSpecs(activeModalProjectId);
    if (isVisible(document.getElementById('sup-tab-warehouse'))) {
      loadSupWarehouse(activeModalProjectId);
    }
    loadGeneralWarehouse();
  } else {
    showToast(data.error, 'error');
  }
});

// ─── Табличное добавление ВОМ ─────────────────────────────────
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
    <td class="batch-cell-index">${rowNum}</td>
    <td class="batch-cell-wrap">
      <input type="text" class="batch-cell batch-name" placeholder="Наименование материала">
    </td>
    <td class="batch-cell-wrap">
      <select class="batch-cell batch-unit">
        ${batchUnitOptions()}
      </select>
    </td>
    <td class="batch-cell-wrap">
      <input type="number" class="batch-cell batch-qty" placeholder="0" min="0.001" step="any">
    </td>
    <td class="batch-cell-wrap">
      <input type="number" class="batch-cell batch-price" placeholder="0.00" min="0" step="0.01">
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
    if (tr.querySelector('.batch-name').value.trim() && tr.querySelector('.batch-qty').value && tr.querySelector('.batch-price').value) filled++;
  });
  const s = filled % 10 === 1 && filled % 100 !== 11 ? 'позиция' : filled % 10 >= 2 && filled % 10 <= 4 && (filled % 100 < 10 || filled % 100 >= 20) ? 'позиции' : 'позиций';
  document.getElementById('batch-counter').textContent = `${filled} ${s} заполнено`;
}

function openBatchModal(projectName, type, namePlaceholder, saveCallback) {
  document.getElementById('batch-modal-title').textContent = `Добавить позиции — ${type}`;
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

// Счётчик
document.getElementById('batch-tbody').addEventListener('input', updateBatchCounter);

function parseBatchNumber(value) {
  return parseFloat(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
}

function setBatchCellValue(tr, field, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (field === 'name') {
    tr.querySelector('.batch-name').value = value;
    return;
  }

  if (field === 'unit') {
    const sel = tr.querySelector('.batch-unit');
    if (value && !BATCH_UNITS.includes(value) && ![...sel.options].some(option => option.value === value)) {
      sel.add(new Option(value, value));
    }
    sel.value = value;
    return;
  }

  const number = parseBatchNumber(value);
  if (Number.isNaN(number)) return;
  if (field === 'quantity') tr.querySelector('.batch-qty').value = number;
  if (field === 'price') tr.querySelector('.batch-price').value = number;
}

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
  const fields = ['name', 'unit', 'quantity', 'price'];
  const rowCells = [...currentTr.querySelectorAll('.batch-cell')];
  const startFieldIdx = Math.max(0, rowCells.indexOf(cell));

  pasteRows.forEach((cols, ri) => {
    let tr = allTrs[startIdx + ri];
    if (!tr) { tr = addBatchRow(); allTrs.push(tr); }
    cols.forEach((col, ci) => {
      const field = fields[startFieldIdx + ci];
      if (field) setBatchCellValue(tr, field, col);
    });
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
    const price = parseFloat(tr.querySelector('.batch-price').value);
    if (name && qty > 0) {
      if (Number.isNaN(price) || price < 0) return;
      items.push({ material_name: name, unit: unit || undefined, quantity: qty, unit_price: price });
    }
  });
  if (!items.length) { showToast('Заполните хотя бы одну позицию', 'error'); return; }

  const btn = document.getElementById('btn-batch-save');
  btn.disabled = true; btn.textContent = 'Сохранение...';
  if (batchSaveCallback) await batchSaveCallback(items);
  btn.disabled = false; btn.textContent = 'Сохранить в проект';
});

// ─── Документы (в модалке) ────────────────────────────────────
async function loadSupModalDocs(id) {
  const container = document.getElementById('sup-modal-docs-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

// ─── Общий склад ─────────────────────────────────────────────
async function loadGeneralWarehouse() {
  const tbody = document.querySelector('#general-warehouse-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Загрузка...</td></tr>';
  const { ok, data } = await apiRequest('GET', '/api/supplier/general-warehouse');
  if (!ok) { tbody.innerHTML = '<tr><td colspan="7" class="table-error">Ошибка загрузки</td></tr>'; return; }
  generalWarehouseCache = data.data || [];
  if (!generalWarehouseCache.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Склад пуст</td></tr>'; return; }

  tbody.innerHTML = generalWarehouseCache.map(r => {
    const available = Number(r.qty_total) - Number(r.qty_reserved);
    return `
      <tr>
        <td><strong>${escHtml(r.material_name)}</strong></td>
        <td>${escHtml(r.unit || '—')}</td>
        <td>${r.qty_total}</td>
        <td>${r.qty_reserved}</td>
        <td class="table-cell-strong ${qtyStateClass(available)}">${available}</td>
        <td class="table-cell-muted-xs">${escHtml(r.notes || '—')}</td>
        <td class="table-cell-nowrap">
          <button class="btn btn-outline btn-sm supplier-small-btn"
            data-action="edit-general" data-id="${r.id}"
            data-name="${escHtml(r.material_name)}" data-unit="${escHtml(r.unit || '')}"
            data-qty="${r.qty_total}" data-notes="${escHtml(r.notes || '')}">
            Ред.
          </button>
          <button class="btn btn-outline btn-sm supplier-small-btn"
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
    generalWarehouseCache = null;
    loadGeneralWarehouse();
  } else showToast(data.error, 'error');
});

document.getElementById('general-warehouse-table').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-action="edit-general"]');
  if (editBtn) {
    activeEditGeneralId = editBtn.dataset.id;
    document.getElementById('edit-general-info').innerHTML =
      `<strong>${escHtml(editBtn.dataset.name)}</strong>`;
    const form = document.getElementById('edit-general-form');
    form.reset();
    form.querySelector('[name=item_id]').value = activeEditGeneralId;
    form.querySelector('[name=unit]').value = editBtn.dataset.unit || '';
    form.querySelector('[name=qty_total]').value = editBtn.dataset.qty || '0';
    form.querySelector('[name=notes]').value = editBtn.dataset.notes || '';
    openModal('modal-edit-general');
    return;
  }

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
    generalWarehouseCache = null;
    loadGeneralWarehouse();
  } else showToast(data.error, 'error');
});

document.getElementById('edit-general-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeEditGeneralId) return;

  const fd = new FormData(e.target);
  const body = {
    unit: fd.get('unit') || undefined,
    qty_total: parseFloat(fd.get('qty_total')) || 0,
  };
  if (fd.get('notes')) body.notes = fd.get('notes');

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('PUT', `/api/supplier/general-warehouse/${activeEditGeneralId}`, body);
  btn.disabled = false;

  if (ok) {
    showToast('Позиция обновлена', 'success');
    closeModal('modal-edit-general');
    generalWarehouseCache = null;
    loadGeneralWarehouse();
  } else showToast(data.error, 'error');
});

// ─── Заявки МТР ──────────────────────────────────────────────
async function loadMtrAll(filterProjectId = '') {
  const tbody = document.querySelector('#mtr-table tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Загрузка...</td></tr>';

  const projects = filterProjectId
    ? projectsList.filter(p => p.id == filterProjectId)
    : projectsList;

  const responses = await Promise.all(
    projects.map(async (p) => {
      const { ok, data } = await apiRequest('GET', `/api/supplier/projects/${p.id}/mtr-requests`);
      if (!ok) return [];
      return data.data.map((row) => ({ ...row, project_name: p.name }));
    })
  );
  const allRows = responses.flat();

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Заявок нет</td></tr>';
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
        <div class="table-cell-muted-xs">${escHtml(r.project_name)}</div>
        ${r.notes ? `<div class="table-cell-muted-xs">${escHtml(r.notes)}</div>` : ''}
      </td>
      <td>${r.quantity} ${escHtml(r.unit || '')}</td>
      <td class="table-cell-muted-md">${escHtml(r.foreman_name || '—')}</td>
      <td class="table-cell-muted-md">${escHtml(r.stage_name || '—')}</td>
      <td>${badge(r.status)}</td>
      <td class="table-cell-muted-md">${formatDate(r.created_at)}</td>
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
    <p class="supplier-modal-meta">Количество: ${btn.dataset.qty} ${escHtml(btn.dataset.unit)}</p>
    ${btn.dataset.notes ? `<p class="table-cell-muted-md">${escHtml(btn.dataset.notes)}</p>` : ''}
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
