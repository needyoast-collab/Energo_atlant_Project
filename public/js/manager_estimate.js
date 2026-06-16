// ─── Смета менеджера: ВОР, ВОМ, сводка ───────────────────────
(function () {
  let activeWorkSpecEditId = null;
  let activeEstimateTab = 'summary';
  const state = {
    getActiveProjectId: () => null,
    getActiveProject: () => null,
    getProjectsList: () => [],
    canManageStages: () => false,
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function getActiveProject() {
    return state.getActiveProject?.() || null;
  }

  function getProjectsList() {
    return state.getProjectsList?.() || [];
  }

  function canManageStages() {
    return Boolean(state.canManageStages?.());
  }

  function refreshKp(projectId) {
    window.ManagerKp?.refreshButtonState(projectId);
  }

  function resetVorForm() {
    const form = document.getElementById('vor-add-form');
    if (!form) return;
    activeWorkSpecEditId = null;
    form.reset();
    form.classList.add('is-hidden');
    form.querySelector('[name="manager_price"]').placeholder = 'Из справочника';
    form.querySelector('button[type="submit"]').textContent = 'Добавить';
    setVorPriceHint();
  }

  function resetForProject(project) {
    resetVorForm();

    const generateBtn = document.getElementById('btn-generate-stages');
    if (!generateBtn || !project) return;

    const canGenerateStages = canManageStages();
    const generated = !!project.stages_generated;
    const kpSent = Boolean(project.kp_sent_at);
    generateBtn.disabled = !canGenerateStages || generated || !kpSent;
    generateBtn.classList.toggle('is-hidden', !canGenerateStages || generated);
    generateBtn.title = canGenerateStages
      ? (kpSent ? '' : 'Сначала отправьте КП заказчику')
      : 'Формировать этапы может только администратор или прораб';
  }

  function switchTab(tab = activeEstimateTab) {
    activeEstimateTab = tab;
    document.querySelectorAll('[data-estimate-tab]').forEach((btn) => {
      const isActive = btn.dataset.estimateTab === tab;
      if (btn.classList.contains('manager-estimate-tab')) {
        btn.classList.toggle('active', isActive);
      } else {
        btn.className = isActive ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
      }
    });

    const summary = document.getElementById('estimate-tab-summary');
    const works = document.getElementById('estimate-tab-works');
    const materials = document.getElementById('estimate-tab-materials');
    if (summary) summary.classList.toggle('is-hidden', tab !== 'summary');
    if (works) works.classList.toggle('is-hidden', tab !== 'works');
    if (materials) materials.classList.toggle('is-hidden', tab !== 'materials');
  }

  function getVorPriceMeta(workSpec) {
    const hasManagerPrice = workSpec.manager_price !== null
      && workSpec.manager_price !== undefined
      && workSpec.manager_price !== '';
    const managerPrice = hasManagerPrice ? Number(workSpec.manager_price) : null;
    const catalogPrice = workSpec.catalog_price !== null
      && workSpec.catalog_price !== undefined
      && workSpec.catalog_price !== ''
      ? Number(workSpec.catalog_price)
      : null;

    if (managerPrice !== null && !Number.isNaN(managerPrice)) {
      return {
        price: managerPrice,
        source: 'manager',
        hint: catalogPrice !== null ? 'Ручная цена менеджера' : 'Цена задана менеджером',
      };
    }

    if (catalogPrice !== null && !Number.isNaN(catalogPrice) && catalogPrice > 0) {
      return {
        price: catalogPrice,
        source: 'catalog',
        hint: 'Цена из справочника работ',
      };
    }

    return {
      price: 0,
      source: 'empty',
      hint: 'Цена не задана',
    };
  }

  function setVorPriceHint({ catalogPrice = null, isOverride = false } = {}) {
    const hint = document.getElementById('vor-price-hint');
    if (!hint) return;

    if (catalogPrice && !isOverride) {
      hint.textContent = `Если поле пустое, используется цена из утверждённого справочника работ: ${formatMoney(catalogPrice)}.`;
      return;
    }

    if (catalogPrice && isOverride) {
      hint.textContent = `Сейчас задана ручная цена менеджера. Очистите поле и сохраните, чтобы вернуться к цене из справочника: ${formatMoney(catalogPrice)}.`;
      return;
    }

    hint.textContent = 'Если поле пустое, используется цена из утверждённого справочника работ.';
  }

  function renderVorRow(workSpec) {
    const priceMeta = getVorPriceMeta(workSpec);
    const price = priceMeta.price;
    const regionalCoeff = Number(getActiveProject()?.regional_coeff || 1.0);
    const sum = price * Number(workSpec.quantity) * regionalCoeff;
    const sumStr = sum ? `${sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽` : '—';
    const priceLabel = price
      ? `${price.toLocaleString('ru-RU')} ₽`
      : '<span class="manager-estimate-warning">Не задана</span>';
    const priceHint = priceMeta.source === 'empty'
      ? ''
      : `<div class="manager-estimate-cell-hint">${priceMeta.hint}</div>`;

    return `
      <tr>
        <td>${escHtml(workSpec.work_name)}</td>
        <td class="num">${workSpec.quantity}</td>
        <td class="muted">${escHtml(workSpec.unit || '—')}</td>
        <td class="num strong">
          ${priceLabel}
          ${priceHint}
        </td>
        <td class="num strong">${sumStr}</td>
        <td class="actions">
          <div class="manager-estimate-row-actions">
            <button class="manager-stage-action manager-stage-action-edit"
            data-action="edit-vor"
            data-id="${workSpec.id}"
            data-work-name="${escHtml(workSpec.work_name)}"
            data-unit="${escHtml(workSpec.unit || '')}"
            data-quantity="${workSpec.quantity}"
            data-price="${workSpec.manager_price ?? ''}"
            data-catalog-price="${workSpec.catalog_price ?? ''}">Ред.</button>
            <button class="manager-stage-action manager-stage-action-delete"
              data-action="delete-vor" data-id="${workSpec.id}" aria-label="Удалить позицию">×</button>
          </div>
        </td>
      </tr>
    `;
  }

  function setEstimateLoading() {
    const vor = document.getElementById('vor-list');
    const specs = document.getElementById('vom-list');
    const summary = document.getElementById('estimate-summary');
    if (vor) vor.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';
    if (specs) specs.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';
    if (summary) summary.innerHTML = '<span class="text-muted">Загрузка...</span>';
  }

  async function fetchWorkSpecs(projectId) {
    const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/work-specs`);
    if (!ok) throw new Error(data?.error || 'Не удалось загрузить ВОР');
    return data.data || [];
  }

  async function fetchMaterialSpecs(projectId) {
    const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/specs`);
    if (!ok) throw new Error(data?.error || 'Не удалось загрузить ВОМ');
    return data.data || [];
  }

  function renderVOR(workSpecs) {
    const container = document.getElementById('vor-list');
    if (!container) return;

    if (!workSpecs.length) {
      container.innerHTML = '<div class="manager-estimate-empty">ВОР пустой</div>';
      return;
    }

    container.innerHTML = `
      <div class="manager-estimate-table-wrap">
        <table class="manager-estimate-table">
          <thead><tr>
            <th>Вид работ</th>
            <th class="num">Количество</th>
            <th>Ед.</th>
            <th class="num">Цена за ед.</th>
            <th class="num">Сумма</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${workSpecs.map(renderVorRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function loadVOR(projectId) {
    const container = document.getElementById('vor-list');
    if (!container) return;
    container.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';

    try {
      renderVOR(await fetchWorkSpecs(projectId));
      refreshKp(projectId);
    } catch {
      container.innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>';
    }
  }

  function renderSpecs(materialSpecs) {
    const container = document.getElementById('vom-list');
    if (!container) return;

    if (!materialSpecs.length) {
      container.innerHTML = '<div class="manager-estimate-empty">Ведомость материалов пуста</div>';
      return;
    }

    container.innerHTML = `
      <div class="manager-estimate-table-wrap">
        <table class="manager-estimate-table">
          <thead><tr>
            <th>Материал</th>
            <th class="num">Кол-во</th>
            <th>Ед.</th>
            <th class="num">Цена</th>
            <th class="num">Сумма</th>
            <th>Статус</th>
            <th>Снабженец</th>
          </tr></thead>
          <tbody>
            ${materialSpecs.map((spec) => `
              <tr>
                <td>${escHtml(spec.material_name)}</td>
                <td class="num">${spec.quantity}</td>
                <td class="muted">${escHtml(spec.unit || '—')}</td>
                <td class="num">${formatMoney(Number(spec.unit_price || 0))}</td>
                <td class="num strong">${formatMoney(Number(spec.quantity) * Number(spec.unit_price || 0))}</td>
                <td>${badge(spec.status)}</td>
                <td class="muted small">${escHtml(spec.supplier_name || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function loadSpecs(projectId) {
    const container = document.getElementById('vom-list');
    if (!container) return;
    container.innerHTML = '<div class="manager-estimate-empty">Загрузка...</div>';

    try {
      renderSpecs(await fetchMaterialSpecs(projectId));
      refreshKp(projectId);
    } catch {
      container.innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>';
    }
  }

  function renderSummary(works, materials) {
    const container = document.getElementById('estimate-summary');
    if (!container) return;

    const worksBaseTotal = works.reduce((acc, item) => {
      const price = Number(item.manager_price ?? item.catalog_price ?? 0);
      return acc + (Number(item.quantity) * price);
    }, 0);
    const materialsTotal = materials.reduce((acc, item) => (
      acc + (Number(item.quantity) * Number(item.unit_price || 0))
    ), 0);
    const regionalCoeff = Number(getActiveProject()?.regional_coeff || 1);
    const worksTotal = parseFloat((worksBaseTotal * regionalCoeff).toFixed(2));
    const totalPositions = works.length + materials.length;
    const grandTotal = parseFloat((worksTotal + materialsTotal).toFixed(2));

    container.innerHTML = `
      <div class="manager-estimate-summary-grid">
        <div class="manager-estimate-summary-card manager-estimate-summary-card-main">
          <div class="manager-estimate-summary-top">
            <div>
              <div class="manager-estimate-summary-label">Итог по проекту</div>
              <div class="manager-estimate-summary-total">${formatMoney(grandTotal)}</div>
            </div>
            <div class="manager-estimate-summary-coeff">
              <div class="manager-estimate-summary-label">Коэффициент проекта</div>
              <strong>${regionalCoeff.toFixed(3)}</strong>
            </div>
          </div>
          <div class="manager-estimate-metrics">
            <div>
              <span>Работы</span>
              <strong>${formatMoney(worksTotal)}</strong>
              <small>Позиций: ${works.length}${regionalCoeff !== 1 ? ` · с кэф. ${regionalCoeff.toFixed(3)}` : ''}</small>
            </div>
            <div>
              <span>Материалы</span>
              <strong>${formatMoney(materialsTotal)}</strong>
              <small>Позиций: ${materials.length}</small>
            </div>
            <div>
              <span>Состав</span>
              <strong>${totalPositions}</strong>
              <small>Всего позиций</small>
            </div>
          </div>
        </div>
        <div class="manager-estimate-summary-card">
          <div class="manager-estimate-summary-label">Структура сметы</div>
          <div class="manager-estimate-breakdown">
            <div>
              <span>Работы</span>
              <strong>${formatMoney(worksTotal)}</strong>
            </div>
            <div>
              <span>Материалы</span>
              <strong>${formatMoney(materialsTotal)}</strong>
            </div>
            <div class="manager-estimate-breakdown-total">
              <span>Итог сметы</span>
              <strong>${formatMoney(grandTotal)}</strong>
            </div>
          </div>
          <div class="manager-estimate-summary-note">
            Материалы считаются по цене, указанной снабженцем в ведомости материалов. Этот же расчет используется при формировании КП.
          </div>
        </div>
      </div>
    `;
  }

  async function loadSummary(projectId) {
    const container = document.getElementById('estimate-summary');
    if (!container) return;
    container.innerHTML = '<span class="text-muted">Загрузка...</span>';

    try {
      const [works, materials] = await Promise.all([
        fetchWorkSpecs(projectId),
        fetchMaterialSpecs(projectId),
      ]);
      renderSummary(works, materials);
    } catch {
      container.innerHTML = '<span class="text-muted">Ошибка загрузки</span>';
    }
  }

  async function load(projectId) {
    setEstimateLoading();
    try {
      const [works, materials] = await Promise.all([
        fetchWorkSpecs(projectId),
        fetchMaterialSpecs(projectId),
      ]);
      renderVOR(works);
      renderSpecs(materials);
      renderSummary(works, materials);
      refreshKp(projectId);
    } catch (err) {
      console.error('[manager-estimate] failed to load estimate', err);
      document.getElementById('vor-list').innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>';
      document.getElementById('vom-list').innerHTML = '<div class="manager-estimate-empty">Ошибка загрузки</div>';
      document.getElementById('estimate-summary').innerHTML = '<span class="text-muted">Ошибка загрузки</span>';
    }
  }

  async function open(projectId) {
    switchTab(activeEstimateTab);
    await load(projectId);
  }

  function fillVorEditForm(editBtn) {
    const form = document.getElementById('vor-add-form');
    if (!form) return;

    const priceInput = form.querySelector('[name="manager_price"]');
    const catalogPrice = editBtn.dataset.catalogPrice ? Number(editBtn.dataset.catalogPrice) : null;
    form.classList.remove('is-hidden');
    form.querySelector('[name="work_name"]').value = editBtn.dataset.workName || '';
    form.querySelector('[name="quantity"]').value = editBtn.dataset.quantity || '';
    form.querySelector('[name="unit"]').value = editBtn.dataset.unit || '';
    priceInput.value = editBtn.dataset.price || '';
    priceInput.placeholder = catalogPrice ? formatMoney(catalogPrice) : 'Из справочника';
    setVorPriceHint({ catalogPrice, isOverride: Boolean(editBtn.dataset.price) });
    activeWorkSpecEditId = editBtn.dataset.id;
    form.querySelector('button[type="submit"]').textContent = 'Сохранить';
  }

  async function deleteVorItem(btn) {
    if (!confirm('Удалить позицию ВОР?')) return;

    const { ok, data } = await apiRequest('DELETE', `/api/manager/work-specs/${btn.dataset.id}`);
    if (ok) {
      showToast('Позиция удалена', 'success');
      load(getActiveProjectId());
    } else {
      showToast(data.error, 'error');
    }
  }

  function toggleVorForm() {
    const form = document.getElementById('vor-add-form');
    if (!form) return;

    activeWorkSpecEditId = null;
    form.reset();
    form.querySelector('[name="manager_price"]').placeholder = 'Из справочника';
    setVorPriceHint();
    form.querySelector('button[type="submit"]').textContent = 'Добавить';
    form.classList.toggle('is-hidden');
  }

  async function submitVorForm(event) {
    event.preventDefault();
    const projectId = getActiveProjectId();
    const fd = new FormData(event.target);
    const body = {
      work_name: fd.get('work_name'),
      quantity: parseFloat(fd.get('quantity')),
    };

    if (fd.get('unit')) body.unit = fd.get('unit');
    if (fd.get('manager_price')) {
      body.manager_price = parseFloat(fd.get('manager_price'));
    } else if (activeWorkSpecEditId) {
      body.manager_price = null;
    }

    const isEdit = !!activeWorkSpecEditId;
    const { ok, data } = isEdit
      ? await apiRequest('PUT', `/api/manager/work-specs/${activeWorkSpecEditId}`, body)
      : await apiRequest('POST', `/api/manager/projects/${projectId}/work-specs`, body);

    if (ok) {
      showToast(isEdit ? 'Позиция обновлена' : 'Позиция добавлена', 'success');
      resetVorForm();
      load(projectId);
    } else {
      showToast(data.error, 'error');
    }
  }

  async function generateStagesFromVor() {
    if (!canManageStages()) {
      showToast('Формировать этапы может только администратор или прораб', 'error');
      return;
    }

    const projectId = getActiveProjectId();
    const project = getActiveProject() || getProjectsList().find((item) => item.id == projectId);

    if (!project?.kp_sent_at) {
      showToast('Сначала отправьте КП заказчику', 'error');
      return;
    }

    if (!confirm('Сформировать этапы из ВОР? Это действие нельзя отменить.')) return;

    const btn = document.getElementById('btn-generate-stages');
    btn.disabled = true;
    const { ok, data } = await apiRequest('POST', `/api/manager/projects/${projectId}/stages/generate-from-vor`);
    btn.disabled = false;

    if (ok) {
      showToast(`Создано этапов: ${data.data.length}`, 'success');
    } else {
      showToast(data.error, 'error');
    }
  }

  function init() {
    document.getElementById('modal-project')?.addEventListener('click', (event) => {
      const estimateTab = event.target.closest('[data-estimate-tab]');
      if (estimateTab) switchTab(estimateTab.dataset.estimateTab);
    });

    document.getElementById('vor-list')?.addEventListener('click', async (event) => {
      const editBtn = event.target.closest('[data-action="edit-vor"]');
      if (editBtn) {
        fillVorEditForm(editBtn);
        return;
      }

      const deleteBtn = event.target.closest('[data-action="delete-vor"]');
      if (deleteBtn) await deleteVorItem(deleteBtn);
    });

    document.getElementById('btn-add-vor')?.addEventListener('click', toggleVorForm);
    document.getElementById('btn-cancel-vor')?.addEventListener('click', resetVorForm);
    document.getElementById('vor-add-form')?.addEventListener('submit', submitVorForm);
    document.getElementById('btn-generate-stages')?.addEventListener('click', generateStagesFromVor);
  }

  window.ManagerEstimate = {
    configure,
    init,
    load,
    loadVOR,
    open,
    resetForProject,
    switchTab,
  };
})();
