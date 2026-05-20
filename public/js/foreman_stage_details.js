// ─── Детали этапа: списания и фото ───────────────────────────
(function () {
  let stageWriteoffItems = [];
  const state = {
    getActiveStageId: () => null,
    getActiveProjectId: () => null,
    reloadStages: async () => {},
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveStageId() {
    return state.getActiveStageId?.() || null;
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function isWarehouseTabVisible() {
    const tab = document.getElementById('tab-warehouse');
    return !!tab && !tab.classList.contains('is-hidden');
  }

  async function reloadStages() {
    await state.reloadStages?.();
  }

  function renderStageWriteoffSelect() {
    const select = document.getElementById('stage-writeoff-item-select');
    const hint = document.getElementById('stage-writeoff-hint');
    if (!select || !hint) return;

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

  async function loadWriteoffHistory(stageId) {
    const list = document.getElementById('stage-writeoff-list');
    if (!list) return;
    list.innerHTML = '<div class="stage-detail-hint">Загрузка списаний...</div>';

    const { ok, data } = await apiRequest('GET', `/api/foreman/stages/${stageId}/writeoffs`);
    if (!ok) {
      list.innerHTML = '<div class="stage-detail-hint is-error">Не удалось загрузить списания</div>';
      return;
    }

    if (!data.data.length) {
      list.innerHTML = '<div class="stage-detail-hint">На этот этап ещё ничего не списано.</div>';
      return;
    }

    list.innerHTML = data.data.map((row) => `
      <div class="stage-writeoff-row">
        <div>
          <div class="stage-writeoff-name">${escHtml(row.material_name)}</div>
          <div class="stage-writeoff-meta">${formatDate(row.created_at)}${row.written_off_by_name ? ` · ${escHtml(row.written_off_by_name)}` : ''}</div>
        </div>
        <div class="stage-writeoff-qty">${row.quantity} ${escHtml(row.unit || '')}</div>
      </div>
    `).join('');
  }

  async function loadPhotos(stageId) {
    const list = document.getElementById('stage-photos-list');
    if (!list) return;
    list.innerHTML = '<div class="stage-detail-hint">Загрузка фото...</div>';

    const { ok, data } = await apiRequest('GET', `/api/foreman/stages/${stageId}/photos`);
    if (!ok) {
      list.innerHTML = '<div class="stage-detail-hint is-error">Не удалось загрузить фото</div>';
      return;
    }

    if (!data.data.length) {
      list.innerHTML = '<div class="stage-detail-hint">Фото для этапа пока не загружены.</div>';
      return;
    }

    list.innerHTML = `
      <div class="stage-photo-grid">
        ${data.data.map((photo) => `
          <div class="stage-photo-card">
            <button type="button" data-action="delete-stage-photo" data-id="${photo.id}" title="Удалить фото"
              class="stage-photo-delete-btn">×</button>
            <a href="${photo.url}" target="_blank" rel="noopener" class="stage-photo-link">
              <img src="${photo.url}" alt="${escHtml(photo.description || 'Фото этапа')}"
                class="stage-photo-thumb">
              <div class="stage-photo-body">
                <div class="stage-photo-title">${escHtml(photo.description || 'Без описания')}</div>
                <div class="stage-photo-date">${formatDate(photo.uploaded_at)}</div>
              </div>
            </a>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function load(stageId = getActiveStageId(), projectId = getActiveProjectId()) {
    if (!stageId || !projectId) return;
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/warehouse`);
    stageWriteoffItems = ok
      ? data.data.filter((item) => Number(item.qty_balance) > 0)
      : [];

    const qtyInput = document.getElementById('stage-writeoff-qty');
    if (qtyInput) qtyInput.value = '';
    renderStageWriteoffSelect();
    await loadWriteoffHistory(stageId);
    await loadPhotos(stageId);
  }

  async function addWriteoff() {
    const stageId = getActiveStageId();
    const projectId = getActiveProjectId();
    if (!stageId || !projectId) return;

    const itemId = document.getElementById('stage-writeoff-item-select')?.value;
    const qty = parseFloat(document.getElementById('stage-writeoff-qty')?.value);

    if (!itemId || !(qty > 0)) {
      showToast('Выберите материал и количество', 'error');
      return;
    }

    const btn = document.getElementById('btn-stage-writeoff-add');
    btn.disabled = true;
    const { ok, data } = await apiRequest('POST', `/api/foreman/warehouse/${itemId}/writeoff`, {
      quantity: qty,
      stage_id: parseInt(stageId, 10),
    });
    btn.disabled = false;

    if (!ok) {
      showToast(data.error, 'error');
      return;
    }

    showToast('Материал списан на этап', 'success');
    await load(stageId, projectId);
    if (isWarehouseTabVisible()) {
      window.ForemanWarehouse?.loadProject(projectId);
    }
    await reloadStages();
  }

  async function deletePhoto(event) {
    const btn = event.target.closest('[data-action="delete-stage-photo"]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    if (!confirm('Удалить фото этапа?')) return;

    btn.disabled = true;
    const { ok, data } = await apiRequest('DELETE', `/api/foreman/photos/${btn.dataset.id}`);
    if (!ok) {
      btn.disabled = false;
      showToast(data.error, 'error');
      return;
    }

    showToast('Фото удалено', 'success');
    loadPhotos(getActiveStageId());
  }

  async function uploadPhoto(event) {
    event.preventDefault();
    const stageId = getActiveStageId();
    if (!stageId) return;

    const fd = new FormData(event.target);
    const photo = fd.get('photo');
    if (!(photo instanceof File) || !photo.name) {
      showToast('Выберите фото', 'error');
      return;
    }

    const btn = event.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';

    const formData = new FormData();
    formData.append('photo', photo);
    if (fd.get('description')) formData.append('description', fd.get('description'));

    const { ok, data } = await apiRequest('POST', `/api/foreman/stages/${stageId}/photos`, formData);
    btn.disabled = false;
    btn.textContent = 'Загрузить';

    if (!ok) {
      showToast(data.error, 'error');
      return;
    }

    event.target.reset();
    showToast('Фото загружено', 'success');
    loadPhotos(stageId);
  }

  function init() {
    document.getElementById('btn-stage-writeoff-add')?.addEventListener('click', addWriteoff);
    document.getElementById('stage-photos-list')?.addEventListener('click', deletePhoto);
    document.getElementById('stage-photo-inline-form')?.addEventListener('submit', uploadPhoto);
  }

  window.ForemanStageDetails = {
    configure,
    init,
    load,
    loadPhotos,
  };
})();
