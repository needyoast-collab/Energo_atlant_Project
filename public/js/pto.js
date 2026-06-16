let currentUser = null;
let projectsList = [];
let activeProjectId = null;
let activeModalProjectId = null;
let docTypes = {};
let loadedPtoTabs = new Set();
let ptoTabLoadPromises = new Map();
const PTO_TABS = ['stages', 'docs'];

function resetPtoTabCache() {
  loadedPtoTabs = new Set();
  ptoTabLoadPromises = new Map();
}

function loadPtoTabData(tab, { force = false } = {}) {
  if (!activeModalProjectId || (!force && loadedPtoTabs.has(tab))) return Promise.resolve();
  if (!force && ptoTabLoadPromises.has(tab)) return ptoTabLoadPromises.get(tab);

  const loaders = {
    stages: () => loadStages(activeModalProjectId),
    docs: () => loadModalDocs(activeModalProjectId),
  };
  const loader = loaders[tab];
  if (!loader) return Promise.resolve();

  const promise = Promise.resolve(loader())
    .then(() => loadedPtoTabs.add(tab))
    .catch((err) => {
      loadedPtoTabs.delete(tab);
      throw err;
    })
    .finally(() => ptoTabLoadPromises.delete(tab));
  ptoTabLoadPromises.set(tab, promise);
  return promise;
}

function invalidatePtoTabs(...tabs) {
  tabs.forEach((tab) => loadedPtoTabs.delete(tab));
}

function preloadPtoTabs(priorityTab) {
  const tabs = [
    priorityTab,
    ...PTO_TABS.filter((tab) => tab !== priorityTab),
  ];
  return Promise.allSettled(tabs.map((tab) => loadPtoTabData(tab)));
}

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.PTO);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);
    await Promise.allSettled([loadDocTypes(), loadProjects()]);
  } finally {
    window.hidePreloader?.();
  }
}

async function loadDocTypes() {
  const { ok, data } = await apiRequest('GET', '/api/pto/doc-types');
  if (!ok) return;
  docTypes = data.data;
  const sel = document.getElementById('doc-type-select');
  sel.innerHTML = '<option value="">— выберите —</option>' +
    Object.entries(docTypes).map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('');
}

// ─── Навигация ────────────────────────────────────────────────
initNav();

// ─── Проекты ─────────────────────────────────────────────────
async function loadProjects() {
  const { ok, data } = await apiRequest('GET', '/api/pto/projects');
  if (!ok) return;
  projectsList = data.data;

  const sel = document.getElementById('docs-project-select');
  sel.innerHTML = '<option value="">— выберите проект —</option>' +
    projectsList.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  const container = document.getElementById('projects-list');
  if (!projectsList.length) {
    container.innerHTML = `<div class="card pto-project-empty">
      Нет проектов. Войдите по коду от менеджера.
    </div>`;
    return;
  }

  container.innerHTML = projectsList.map(p => `
    <div class="card pto-project-card" data-action="open-project" data-id="${p.id}">
      <div class="pto-project-card-head">
        <div class="card-title pto-project-title">${escHtml(p.name)}</div>
        ${badge(p.status)}
      </div>
      <div class="pto-project-muted mb-1">${escHtml(p.code)}</div>
      ${p.address ? `<div class="pto-project-muted">📍 ${escHtml(p.address)}</div>` : ''}
      ${p.manager_name ? `<div class="pto-project-muted pto-project-manager">Менеджер: ${escHtml(p.manager_name)}</div>` : ''}
      <div class="pto-project-open">Нажмите чтобы посмотреть этапы →</div>
    </div>
  `).join('');
}

document.getElementById('projects-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-action="open-project"]');
  if (!card) return;
  const id = card.dataset.id;
  const project = projectsList.find(p => p.id == id);
  if (!project) return;

  activeModalProjectId = id;
  resetPtoTabCache();
  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML =
    `${badge(project.status)} <span class="pto-code-offset">${escHtml(project.code)}</span>
     ${project.address ? ` · 📍 ${escHtml(project.address)}` : ''}`;

  openModal('modal-project');
  await switchPtoTab('stages', { force: true }).catch(() => {});
  await preloadPtoTabs('stages');
});

function switchPtoTab(tab, options = {}) {
  document.getElementById('pto-tab-stages').classList.toggle('is-hidden', tab !== 'stages');
  document.getElementById('pto-tab-docs').classList.toggle('is-hidden', tab !== 'docs');
  document.getElementById('pto-tab-btn-stages').className = tab === 'stages' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  document.getElementById('pto-tab-btn-docs').className   = tab === 'docs'   ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  return loadPtoTabData(tab, options);
}

document.querySelectorAll('[data-ptotab]').forEach(btn => {
  btn.addEventListener('click', () => switchPtoTab(btn.dataset.ptotab));
});

async function loadModalDocs(id) {
  const container = document.getElementById('pto-modal-docs-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

async function loadStages(id) {
  const list = document.getElementById('modal-stages-list');
  list.innerHTML = '<div class="text-muted">Загрузка...</div>';

  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/stages`);
  if (!ok) { list.innerHTML = '<div class="text-danger">Ошибка загрузки</div>'; return; }

  if (!data.data.length) {
    list.innerHTML = '<div class="text-muted">Этапов нет</div>';
    return;
  }

  list.innerHTML = data.data.map(s => `
    <div class="stage-item">
      <div class="stage-status-dot dot-${s.status}"></div>
      <div class="pto-stage-content">
        <div class="stage-name">${escHtml(s.name)}</div>
        <div class="stage-dates">
          ${s.planned_start ? `${formatDate(s.planned_start)} — ${formatDate(s.planned_end)}` : 'Даты не указаны'}
          ${s.actual_end ? ` · Факт: ${formatDate(s.actual_end)}` : ''}
        </div>
      </div>
      ${badge(s.status)}
    </div>
  `).join('');
}

// ─── Документы ───────────────────────────────────────────────
document.getElementById('docs-project-select').addEventListener('change', (e) => {
  activeProjectId = e.target.value;
  if (activeProjectId) {
    document.getElementById('upload-section').classList.remove('is-hidden');
    loadDocs(activeProjectId);
  } else {
    document.getElementById('upload-section').classList.add('is-hidden');
    document.getElementById('docs-list').innerHTML = '<span class="text-muted">Выберите проект</span>';
  }
});

async function loadDocs(id) {
  const container = document.getElementById('docs-list');
  container.innerHTML = '<span class="text-muted">Загрузка...</span>';

  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span class="text-danger">Ошибка загрузки</span>'; return; }

  if (!data.data.length) {
    container.innerHTML = '<span class="text-muted">Документов нет</span>';
    return;
  }

  // Группируем по типу
  const grouped = {};
  data.data.forEach(doc => {
    const label = doc.doc_label || docTypes[doc.doc_type] || doc.doc_type;
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(doc);
  });

  container.innerHTML = Object.entries(grouped).map(([label, docs]) => `
    <div class="pto-doc-group">
      <div class="pto-doc-group-title">${escHtml(label)}</div>
      ${docs.map(doc => `
        <div class="pto-doc-row">
          <div>
            <div class="pto-doc-file">${escHtml(doc.file_name)}</div>
            <div class="pto-doc-meta">
              ${escHtml(doc.uploaded_by_name)} · ${formatDate(doc.uploaded_at)}
              ${doc.description ? ' · ' + escHtml(doc.description) : ''}
            </div>
          </div>
          <div class="pto-doc-actions">
            <a href="${safeAttrUrl(doc.url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm pto-doc-btn">Скачать</a>
            ${doc.uploaded_by_id === currentUser.id ? `
              <button class="btn btn-sm pto-delete-doc-btn"
                data-action="delete-doc" data-id="${doc.id}">✕</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

document.getElementById('docs-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-doc"]');
  if (!btn) return;
  if (!confirm('Удалить документ?')) return;
  const { ok, data } = await apiRequest('DELETE', `/api/pto/documents/${btn.dataset.id}`);
  if (ok) {
    showToast('Документ удалён', 'success');
    loadDocs(activeProjectId);
    if (String(activeModalProjectId || '') === String(activeProjectId || '')) {
      invalidatePtoTabs('docs');
    }
  }
  else showToast(data.error, 'error');
});

document.getElementById('upload-doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeProjectId) return showToast('Выберите проект', 'error');
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Загрузка...';

  const { ok, data } = await apiRequest('POST', `/api/pto/projects/${activeProjectId}/documents`, fd);
  btn.disabled = false; btn.textContent = 'Загрузить';

  if (ok) {
    showToast('Документ загружен', 'success');
    e.target.reset();
    loadDocs(activeProjectId);
    if (String(activeModalProjectId || '') === String(activeProjectId || '')) {
      invalidatePtoTabs('docs');
    }
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
  const { ok, data } = await apiRequest('POST', '/api/pto/projects/join', { code });
  if (ok) {
    showToast(`Вы добавлены в проект «${data.data.name}»`, 'success');
    closeModal('modal-join');
    loadProjects();
  } else showToast(data.error, 'error');
});

init();
