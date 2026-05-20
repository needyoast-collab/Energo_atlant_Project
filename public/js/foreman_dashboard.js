window.FOREMAN_PAGE_MODE = 'dashboard';

let foremanDashboard = null;

function getBalanceClass(value) {
  const num = Number(value);
  if (num > 0) return 'text-success';
  if (num < 0) return 'text-danger';
  return 'text-muted';
}

window.initForemanModeNavigation = (context) => {
  foremanDashboard = context;
  initNav((section) => {
    if (section === 'mtr') loadMtrAll();
    if (section === 'warehouse') loadWarehouseAll();
  });
};

window.initForemanAfterProjects = (context) => {
  foremanDashboard = context;

  document.getElementById('projects-list')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-action="open-project"]');
    if (!card) return;
    window.location.href = `/foreman_project.html?id=${encodeURIComponent(card.dataset.id)}`;
  });

  document.getElementById('btn-join-project')?.addEventListener('click', () => {
    document.getElementById('join-form').reset();
    openModal('modal-join');
  });

  document.getElementById('join-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = new FormData(e.target).get('code').toUpperCase();
    const { ok, data } = await apiRequest('POST', '/api/foreman/projects/join', { code });
    if (!ok) {
      showToast(data.error, 'error');
      return;
    }

    showToast(`Вы добавлены в проект «${data.data.name}»`, 'success');
    closeModal('modal-join');
    await foremanDashboard.reloadProjects();
  });

  document.getElementById('warehouse-table')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="writeoff"]');
    if (!btn) return;
    foremanDashboard.startWarehouseWriteoff(btn, btn.dataset.projectId);
  });
};

async function loadMtrAll() {
  const projects = await foremanDashboard.ensureProjects();
  const sel = document.getElementById('mtr-project-select');
  const tbody = document.querySelector('#mtr-table tbody');
  if (!sel || !tbody) return;

  sel.innerHTML = projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Загрузка...</td></tr>';

  const responses = await Promise.all(
    projects.map(async (p) => {
      const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${p.id}/mtr-requests`);
      if (!ok) return [];
      return data.data.map((row) => ({ ...row, project_name: p.name }));
    })
  );
  const allRows = responses.flat();

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Заявок нет</td></tr>';
    return;
  }

  tbody.innerHTML = allRows.map(r => `
    <tr>
      <td>
        <strong>${escHtml(r.material_name)}</strong>
        <div class="table-cell-muted-xs">${escHtml(r.project_name)}</div>
        ${r.notes ? `<div class="table-cell-muted-sm">${escHtml(r.notes)}</div>` : ''}
      </td>
      <td>${r.quantity} ${escHtml(r.unit || '')}</td>
      <td class="table-cell-muted-md">${escHtml(r.stage_name || '—')}</td>
      <td>${badge(r.status)}</td>
      <td class="table-cell-muted-md">${formatDate(r.created_at)}</td>
    </tr>
  `).join('');
}

async function loadWarehouseAll() {
  const projects = await foremanDashboard.ensureProjects();
  const tbody = document.querySelector('#warehouse-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Загрузка...</td></tr>';

  const responses = await Promise.all(
    projects.map(async (p) => {
      const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${p.id}/warehouse`);
      if (!ok) return [];
      return data.data.map((row) => ({ ...row, project_name: p.name, project_id: p.id }));
    })
  );
  const allRows = responses.flat();

  if (!allRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Склад пуст</td></tr>';
    return;
  }

  tbody.innerHTML = allRows.map(r => `
    <tr>
      <td>
        <strong>${escHtml(r.material_name)}</strong>
        <div class="table-cell-muted-xs">${escHtml(r.project_name)}</div>
      </td>
      <td>${escHtml(r.unit || '—')}</td>
      <td>${r.qty_total}</td>
      <td>${r.qty_used}</td>
      <td class="table-cell-strong ${getBalanceClass(r.qty_balance)}">
        ${r.qty_balance}
      </td>
      <td class="table-cell-muted-xs">${escHtml(foremanDashboard.sourceLabels[r.source] || r.source)}</td>
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

window.foremanDashboardLoadMtrAll = loadMtrAll;
window.foremanDashboardLoadWarehouseAll = loadWarehouseAll;
window.initForeman?.('dashboard');
