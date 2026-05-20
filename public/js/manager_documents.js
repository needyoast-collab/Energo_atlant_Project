// ─── Документы проекта менеджера ─────────────────────────────
(function () {
  let docTypes = {};
  let activeDocsFilter = 'all';
  let docsCache = [];
  let pendingHighlightId = null;

  const state = {
    getActiveProjectId: () => null,
    getCurrentUser: () => null,
  };

  const FINANCE_DOC_TYPES = new Set(window.FINANCIAL_DOC_TYPES);
  const TECH_DOC_TYPES = new Set(window.TECHNICAL_DOC_TYPES);
  const REQUIRED_DOC_GROUPS = [
    { label: 'КП', types: ['kp'] },
    { label: 'Смета', types: ['estimate'] },
    { label: 'Договор', types: ['contract'] },
    { label: 'КС-2', types: ['ks2'] },
    { label: 'КС-3', types: ['ks3'] },
    { label: 'РД / ТУ', types: ['rd', 'tu'] },
  ];
  const DOC_FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'finance', label: 'Финансы' },
    { key: 'tech', label: 'Тех.' },
    { key: 'other', label: 'Прочие' },
  ];

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function getCurrentUser() {
    return state.getCurrentUser?.() || null;
  }

  function setHighlight(notification) {
    pendingHighlightId = notification?.entity_type === 'document'
      ? String(notification.entity_id || '')
      : null;
  }

  function resetForm() {
    document.getElementById('upload-doc-form')?.reset();
  }

  async function loadTypes() {
    const { ok, data } = await apiRequest('GET', '/api/manager/doc-types');
    if (!ok) return;

    docTypes = data.data || {};
    const select = document.getElementById('doc-type-select');
    if (!select) return;
    select.innerHTML = '<option value="">— выберите тип —</option>' +
      Object.entries(docTypes).map(([value, label]) => `<option value="${value}">${escHtml(label)}</option>`).join('');
  }

  function getDocKind(docType) {
    if (FINANCE_DOC_TYPES.has(docType)) {
      return { label: 'Финансовый', className: 'is-finance' };
    }
    if (TECH_DOC_TYPES.has(docType)) {
      return { label: 'Технический', className: 'is-tech' };
    }
    return { label: 'Прочее', className: '' };
  }

  function getDocExt(fileName = '') {
    const ext = String(fileName).split('.').pop();
    if (!ext || ext === fileName) return 'DOC';
    return ext.slice(0, 4).toUpperCase();
  }

  function getFilesLabel(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} файл`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} файла`;
    return `${count} файлов`;
  }

  function renderSummary(docs) {
    const container = document.getElementById('manager-docs-summary');
    if (!container) return;

    const latest = docs[0];
    const checklist = REQUIRED_DOC_GROUPS.map((item) => {
      const doc = docs.find((candidate) => item.types.includes(candidate.doc_type));
      return { ...item, doc };
    });
    const readyCount = checklist.filter((item) => item.doc).length;

    container.innerHTML = `
      <div class="manager-docs-summary-head">
        <div class="manager-docs-summary-title">Обязательные документы</div>
        <div class="manager-docs-summary-subtitle">
          ${latest ? `Последнее обновление: ${formatDate(latest.uploaded_at)}` : 'Закрывайте архив по мере движения проекта.'}
        </div>
      </div>
      <div class="manager-docs-check-progress">
        <span>${readyCount} из ${checklist.length}</span>
        <progress value="${readyCount}" max="${checklist.length}"></progress>
      </div>
      <div class="manager-docs-checklist">
        ${checklist.map((item) => `
          <div class="manager-docs-check ${item.doc ? 'is-ready' : ''}">
            <span>${item.doc ? '✓' : '—'}</span>
            <div>
              <strong>${escHtml(item.label)}</strong>
              <em>${item.doc ? escHtml(item.doc.file_name) : 'Не загружено'}</em>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="manager-docs-total-line">
        <div>
          <span>Всего в архиве</span>
          <strong>${docs.length}</strong>
        </div>
      </div>
    `;
  }

  function renderNextDoc(docs) {
    const container = document.getElementById('manager-docs-next');
    if (!container) return;

    const nextItem = REQUIRED_DOC_GROUPS.find((item) =>
      !docs.some((doc) => item.types.includes(doc.doc_type))
    );

    if (!nextItem) {
      container.innerHTML = `
        <div class="manager-docs-next-card is-complete">
          <span>✓</span>
          <div>
            <strong>Обязательный комплект собран</strong>
            <p>Можно загружать дополнительные файлы по проекту.</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="manager-docs-next-card">
        <span>→</span>
        <div>
          <strong>Следующий документ: ${escHtml(nextItem.label)}</strong>
          <p>Подставьте тип в форму и загрузите нужный файл.</p>
        </div>
        <button type="button" data-action="select-next-doc" data-doc-type="${nextItem.types[0]}">Выбрать тип</button>
      </div>
    `;
  }

  function renderDocRow(doc) {
    const kind = getDocKind(doc.doc_type);
    const currentUser = getCurrentUser();
    const canDelete = String(doc.uploaded_by_id) === String(currentUser?.id);

    return `
      <article class="manager-docs-row" data-doc-id="${doc.id}">
        <div class="manager-docs-icon">${escHtml(getDocExt(doc.file_name))}</div>
        <div class="manager-docs-row-main">
          <div class="manager-docs-row-head">
            <strong>${escHtml(doc.doc_label || docTypes[doc.doc_type] || doc.doc_type)}</strong>
            <span class="manager-docs-kind ${kind.className}">${kind.label}</span>
          </div>
          <div class="manager-docs-file-name">${escHtml(doc.file_name)}</div>
        </div>
        <div class="manager-docs-actions">
          <a href="${doc.url}" target="_blank" class="manager-docs-action manager-docs-download"><span>↓</span> Скачать</a>
          ${canDelete ? `
            <div class="manager-docs-menu-wrap">
              <button class="manager-docs-menu-btn" type="button" data-doc-menu aria-label="Действия по документу">...</button>
              <div class="manager-docs-menu">
                <button class="danger" type="button" data-action="delete-doc" data-id="${doc.id}"><span>×</span> Удалить</button>
              </div>
            </div>
          ` : ''}
        </div>
      </article>
    `;
  }

  function matchesFilter(doc, filter) {
    if (filter === 'finance') return FINANCE_DOC_TYPES.has(doc.doc_type);
    if (filter === 'tech') return TECH_DOC_TYPES.has(doc.doc_type);
    if (filter === 'other') return !FINANCE_DOC_TYPES.has(doc.doc_type) && !TECH_DOC_TYPES.has(doc.doc_type);
    return true;
  }

  function renderList(docs) {
    const container = document.getElementById('project-docs-list');
    if (!container) return;

    if (!docs.length) {
      container.innerHTML = '<div class="manager-docs-empty">Документов пока нет. Загрузите первый файл через форму выше.</div>';
      return;
    }

    const filteredDocs = docs.filter((doc) => matchesFilter(doc, activeDocsFilter));
    const counter = activeDocsFilter === 'all'
      ? getFilesLabel(docs.length)
      : `${filteredDocs.length} из ${docs.length}`;

    container.innerHTML = `
      <div class="manager-docs-list-head">
        <div>
          <strong>Архив документов</strong>
          <span>Загруженные файлы по проекту</span>
        </div>
        <div class="manager-docs-list-tools">
          <div class="manager-docs-filters">
            ${DOC_FILTERS.map((filter) => `
              <button type="button" data-doc-filter="${filter.key}" class="${activeDocsFilter === filter.key ? 'active' : ''}">
                ${filter.label}
              </button>
            `).join('')}
          </div>
          <em>${counter}</em>
        </div>
      </div>
      ${filteredDocs.length
        ? filteredDocs.map(renderDocRow).join('')
        : '<div class="manager-docs-empty">В этой категории документов пока нет.</div>'}
    `;
  }

  async function load(projectId = getActiveProjectId()) {
    const container = document.getElementById('project-docs-list');
    if (!container || !projectId) return;
    container.innerHTML = '<div class="manager-docs-empty">Загрузка документов...</div>';

    const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/documents`);
    if (!ok) {
      renderSummary([]);
      container.innerHTML = '<div class="manager-docs-empty">Не удалось загрузить документы.</div>';
      return;
    }

    const docs = data.data || [];
    docsCache = docs;
    renderSummary(docs);
    renderNextDoc(docs);
    renderList(docs);

    if (pendingHighlightId) {
      const target = container.querySelector(`[data-doc-id="${pendingHighlightId}"]`);
      if (target) {
        target.classList.add('entity-highlight');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      pendingHighlightId = null;
    }
  }

  async function deleteDocument(btn) {
    btn.closest('.manager-docs-menu-wrap')?.classList.remove('open');
    if (!confirm('Удалить документ?')) return;

    try {
      const { ok, data } = await apiRequest('DELETE', `/api/manager/documents/${btn.dataset.id}`);
      if (ok) {
        showToast('Документ удалён', 'success');
        load();
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Сетевая ошибка', 'error');
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const projectId = getActiveProjectId();
    if (!projectId) return;

    const fd = new FormData(event.target);
    const btn = event.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.textContent = 'Загрузка...';

    try {
      const { ok, data } = await apiRequest('POST', `/api/manager/projects/${projectId}/documents`, fd);
      if (ok) {
        showToast('Документ загружен', 'success');
        event.target.reset();
        load(projectId);
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Сетевая ошибка', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }

  function init() {
    document.getElementById('project-docs-list')?.addEventListener('click', async (event) => {
      const filterBtn = event.target.closest('[data-doc-filter]');
      if (filterBtn) {
        activeDocsFilter = filterBtn.dataset.docFilter || 'all';
        renderList(docsCache);
        return;
      }

      const menuBtn = event.target.closest('[data-doc-menu]');
      if (menuBtn) {
        const wrap = menuBtn.closest('.manager-docs-menu-wrap');
        document.querySelectorAll('.manager-docs-menu-wrap.open').forEach((item) => {
          if (item !== wrap) item.classList.remove('open');
        });
        wrap?.classList.toggle('open');
        return;
      }

      const deleteBtn = event.target.closest('[data-action="delete-doc"]');
      if (deleteBtn) await deleteDocument(deleteBtn);
    });

    document.getElementById('manager-docs-next')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="select-next-doc"]');
      if (!btn) return;

      const select = document.getElementById('doc-type-select');
      select.value = btn.dataset.docType || '';
      select.focus();
    });

    document.getElementById('upload-doc-form')?.addEventListener('submit', uploadDocument);
  }

  window.ManagerDocuments = {
    configure,
    init,
    load,
    loadTypes,
    resetForm,
    setHighlight,
  };
})();
