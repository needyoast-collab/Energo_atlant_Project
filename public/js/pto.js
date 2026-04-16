let currentUser = null;
let projectsList = [];
let activeProjectId = null;
let activeModalProjectId = null;
let docTypes = {};

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('pto');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;
  await loadDocTypes();
  await loadProjects();
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
    container.innerHTML = `<div class="card" style="color:var(--muted);text-align:center;padding:2rem">
      Нет проектов. Войдите по коду от менеджера.
    </div>`;
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
      <div style="margin-top:.75rem;font-size:.82rem;color:var(--accent)">Нажмите чтобы посмотреть этапы →</div>
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
  document.getElementById('modal-project-title').textContent = project.name;
  document.getElementById('modal-project-meta').innerHTML =
    `${badge(project.status)} <span style="margin-left:.5rem">${escHtml(project.code)}</span>
     ${project.address ? ` · 📍 ${escHtml(project.address)}` : ''}`;

  switchPtoTab('stages');
  await loadStages(id);
  openModal('modal-project');
});

function switchPtoTab(tab) {
  document.getElementById('pto-tab-stages').style.display = tab === 'stages' ? '' : 'none';
  document.getElementById('pto-tab-docs').style.display   = tab === 'docs'   ? '' : 'none';
  document.getElementById('pto-tab-btn-stages').className = tab === 'stages' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  document.getElementById('pto-tab-btn-docs').className   = tab === 'docs'   ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  if (tab === 'docs') loadModalDocs(activeModalProjectId);
}

document.querySelectorAll('[data-ptotab]').forEach(btn => {
  btn.addEventListener('click', () => switchPtoTab(btn.dataset.ptotab));
});

async function loadModalDocs(id) {
  const container = document.getElementById('pto-modal-docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';
  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }
  renderTechDocs(container, data.data);
}

async function loadStages(id) {
  const list = document.getElementById('modal-stages-list');
  list.innerHTML = '<div style="color:var(--muted)">Загрузка...</div>';

  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/stages`);
  if (!ok) { list.innerHTML = '<div style="color:var(--danger)">Ошибка загрузки</div>'; return; }

  if (!data.data.length) {
    list.innerHTML = '<div style="color:var(--muted)">Этапов нет</div>';
    return;
  }

  list.innerHTML = data.data.map(s => `
    <div class="stage-item">
      <div class="stage-status-dot dot-${s.status}"></div>
      <div style="flex:1">
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
    document.getElementById('upload-section').style.display = '';
    loadDocs(activeProjectId);
  } else {
    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('docs-list').innerHTML = '<span style="color:var(--muted)">Выберите проект</span>';
  }
});

async function loadDocs(id) {
  const container = document.getElementById('docs-list');
  container.innerHTML = '<span style="color:var(--muted)">Загрузка...</span>';

  const { ok, data } = await apiRequest('GET', `/api/pto/projects/${id}/documents`);
  if (!ok) { container.innerHTML = '<span style="color:var(--danger)">Ошибка загрузки</span>'; return; }

  if (!data.data.length) {
    container.innerHTML = '<span style="color:var(--muted)">Документов нет</span>';
    return;
  }

  // Группируем по типу
  const grouped = {};
  data.data.forEach(doc => {
    const label = docTypes[doc.doc_type] || doc.doc_type;
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(doc);
  });

  container.innerHTML = Object.entries(grouped).map(([label, docs]) => `
    <div style="margin-bottom:1.25rem">
      <div style="font-weight:700;font-size:.85rem;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">${escHtml(label)}</div>
      ${docs.map(doc => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:.9rem;font-weight:500">${escHtml(doc.file_name)}</div>
            <div style="color:var(--muted);font-size:.78rem">
              ${escHtml(doc.uploaded_by_name)} · ${formatDate(doc.uploaded_at)}
              ${doc.description ? ' · ' + escHtml(doc.description) : ''}
            </div>
          </div>
          <div style="display:flex;gap:.4rem;flex-shrink:0;margin-left:.75rem">
            <a href="${doc.url}" target="_blank" class="btn btn-outline btn-sm" style="font-size:.78rem">Скачать</a>
            ${doc.uploaded_by_id === currentUser.id ? `
              <button class="btn btn-sm" style="font-size:.78rem;color:var(--muted);border:1px solid var(--border);background:transparent;border-radius:9999px"
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
  if (ok) { showToast('Документ удалён', 'success'); loadDocs(activeProjectId); }
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
