// ─── Склад объекта прораба ───────────────────────────────────
(function () {
  let activeWarehouseId = null;
  const state = {
    getActiveProjectId: () => null,
    isProjectPage: () => false,
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function getProjectWarehouseTable() {
    return document.getElementById(state.isProjectPage?.() ? 'project-warehouse-table' : 'modal-warehouse-table');
  }

  function getBalanceClass(value) {
    const num = Number(value);
    if (num > 0) return 'text-success';
    if (num < 0) return 'text-danger';
    return 'text-muted';
  }

  function isWarehouseTabVisible() {
    const tab = document.getElementById('tab-warehouse');
    return !!tab && !tab.classList.contains('is-hidden');
  }

  async function loadProject(projectId = getActiveProjectId()) {
    const tbody = getProjectWarehouseTable()?.querySelector('tbody');
    if (!tbody || !projectId) return;

    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Загрузка...</td></tr>';
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/warehouse`);
    if (!ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-error">Ошибка загрузки</td></tr>';
      return;
    }
    if (!data.data.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Склад пуст</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map((row) => `
      <tr>
        <td><strong>${escHtml(row.material_name)}</strong></td>
        <td>${escHtml(row.unit || '—')}</td>
        <td>${row.qty_total}</td>
        <td>${row.qty_used}</td>
        <td class="table-cell-strong ${getBalanceClass(row.qty_balance)}">
          ${row.qty_balance}
        </td>
        <td>
          <button class="btn btn-outline btn-sm supplier-small-btn" data-action="writeoff"
            data-id="${row.id}" data-name="${escHtml(row.material_name)}"
            data-unit="${escHtml(row.unit || '')}" data-available="${row.qty_balance}">
            Списать
          </button>
        </td>
      </tr>
    `).join('');
  }

  async function populateWriteoffStages(projectId) {
    const select = document.getElementById('writeoff-stage-select');
    if (!select) return;
    select.innerHTML = '<option value="">— выберите этап —</option>';

    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/stages`);
    if (!ok) return;

    select.innerHTML += data.data.map((stage) =>
      `<option value="${stage.id}">${escHtml(stage.name)}</option>`
    ).join('');
  }

  function startWriteoff(btn, projectId) {
    activeWarehouseId = btn.dataset.id;
    document.getElementById('writeoff-item-info').innerHTML =
      `<strong>${escHtml(btn.dataset.name)}</strong> · Доступно: <strong>${btn.dataset.available} ${escHtml(btn.dataset.unit)}</strong>`;
    document.getElementById('writeoff-form').reset();
    populateWriteoffStages(projectId).then(() => openModal('modal-writeoff'));
  }

  async function submitWriteoff(event) {
    event.preventDefault();
    const projectId = getActiveProjectId();
    const formData = new FormData(event.target);
    const quantity = parseFloat(formData.get('quantity'));
    const stage_id = parseInt(formData.get('stage_id'), 10);
    const { ok, data } = await apiRequest('POST', `/api/foreman/warehouse/${activeWarehouseId}/writeoff`, { quantity, stage_id });

    if (ok) {
      showToast('Списание выполнено', 'success');
      closeModal('modal-writeoff');
      if (isWarehouseTabVisible()) {
        loadProject(projectId);
      } else {
        window.foremanDashboardLoadWarehouseAll?.();
      }
    } else {
      showToast(data.error, 'error');
    }
  }

  function init() {
    getProjectWarehouseTable()?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="writeoff"]');
      if (!btn) return;
      startWriteoff(btn, getActiveProjectId());
    });

    document.getElementById('writeoff-form')?.addEventListener('submit', submitWriteoff);
  }

  window.ForemanWarehouse = {
    configure,
    init,
    loadProject,
    startWriteoff,
  };
})();
