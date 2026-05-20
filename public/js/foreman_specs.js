// ─── Ведомость материалов прораба ────────────────────────────
(function () {
  let activeSpecId = null;
  let rejectSpecMode = 'single';
  const state = {
    getActiveProjectId: () => null,
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function getPendingCheckboxes() {
    return Array.from(document.querySelectorAll('#specs-list .spec-approve-checkbox'));
  }

  function updateBulkActions() {
    const checkboxes = getPendingCheckboxes();
    const actionWrap = document.getElementById('specs-bulk-actions');
    const counter = document.getElementById('specs-bulk-counter');
    if (!actionWrap || !counter) return;

    if (!checkboxes.length) {
      actionWrap.classList.add('is-hidden');
      counter.textContent = '0 отмечено';
      return;
    }

    const checkedCount = checkboxes.filter((input) => input.checked).length;
    const selectAll = document.getElementById('spec-select-all');
    if (selectAll) {
      selectAll.checked = checkedCount === checkboxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
    actionWrap.classList.remove('is-hidden');
    counter.textContent = `${checkedCount} отмечено из ${checkboxes.length}`;
  }

  async function load(projectId = getActiveProjectId()) {
    const container = document.getElementById('specs-list');
    if (!container || !projectId) return;

    container.innerHTML = '<div class="text-muted">Загрузка...</div>';
    const { ok, data } = await apiRequest('GET', `/api/foreman/projects/${projectId}/specs`);
    if (!ok) {
      container.innerHTML = '<div class="text-danger">Ошибка загрузки</div>';
      updateBulkActions();
      return;
    }

    const specs = data.data;
    const hasPendingSpecs = specs.some((spec) => spec.status === 'pending_approval');
    if (!specs.length) {
      container.innerHTML = '<div class="text-muted">Ведомость пуста. Снабженец ещё не отправил материалы.</div>';
      updateBulkActions();
      return;
    }

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <label class="manager-check-label">
                  ${hasPendingSpecs ? '<input type="checkbox" id="spec-select-all" aria-label="Выбрать все позиции ВОМ">' : '<span class="supplier-spec-check-placeholder"></span>'}
                  <span>Материал</span>
                </label>
              </th>
              <th class="table-cell-right">Нужно</th>
              <th class="table-cell-right">Поступило</th>
              <th class="table-cell-right">Осталось</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${specs.map((spec) => `
              <tr>
                <td>
                  <div class="supplier-spec-head">
                    ${spec.status === 'pending_approval' ? `
                      <label class="supplier-spec-check">
                        <input type="checkbox" class="spec-approve-checkbox" value="${spec.id}">
                      </label>
                    ` : '<div class="supplier-spec-check-placeholder"></div>'}
                    <div class="supplier-spec-body">
                      <div class="supplier-spec-title">${escHtml(spec.material_name)}</div>
                      <div class="supplier-spec-status">
                        ${escHtml(spec.supplier_name)}
                        ${spec.rejection_note ? ` · <span class="text-danger">Отклонено: ${escHtml(spec.rejection_note)}</span>` : ''}
                        ${spec.approved_at ? ` · Согласовано ${formatDate(spec.approved_at)}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="table-cell-right">${spec.quantity} ${escHtml(spec.unit || '')}</td>
                <td class="table-cell-right">${spec.supplied_qty || 0}</td>
                <td class="table-cell-right">${spec.remaining_qty || 0}</td>
                <td>
                  <div class="project-section-actions">
                    ${badge(spec.status)}
                    ${spec.status === 'pending_approval' ? `
                      <button class="foreman-action-btn is-success is-compact"
                        data-action="approve-spec" data-id="${spec.id}" data-name="${escHtml(spec.material_name)}">
                        Согласовать
                      </button>
                      <button class="foreman-action-btn is-danger is-compact"
                        data-action="reject-spec" data-id="${spec.id}" data-name="${escHtml(spec.material_name)}">
                        Отклонить
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

    updateBulkActions();
  }

  async function approveOne(btn) {
    if (!confirm(`Согласовать «${btn.dataset.name}»?`)) return;
    const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${btn.dataset.id}/approve`);
    if (ok) {
      showToast('Позиция согласована', 'success');
      load();
    } else {
      showToast(data.error, 'error');
    }
  }

  function openRejectSingle(btn) {
    rejectSpecMode = 'single';
    activeSpecId = btn.dataset.id;
    document.getElementById('reject-spec-title').textContent = 'Отклонить позицию';
    document.getElementById('reject-spec-info').textContent = `Материал: ${btn.dataset.name}`;
    document.getElementById('reject-spec-form').reset();
    openModal('modal-reject-spec');
  }

  async function approveSelected() {
    const ids = getPendingCheckboxes()
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
    getPendingCheckboxes().forEach((input) => { input.checked = false; });
    load();
  }

  function openRejectUnchecked() {
    const unchecked = getPendingCheckboxes().filter((input) => !input.checked);
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
  }

  async function rejectSelected(event) {
    event.preventDefault();
    const rejection_note = new FormData(event.target).get('rejection_note');
    const btn = event.target.querySelector('button[type=submit]');
    btn.disabled = true;

    if (rejectSpecMode === 'bulk') {
      const ids = getPendingCheckboxes()
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
      load();
      return;
    }

    const { ok, data } = await apiRequest('PUT', `/api/foreman/specs/${activeSpecId}/reject`, { rejection_note });
    btn.disabled = false;
    if (ok) {
      showToast('Позиция отклонена', 'success');
      closeModal('modal-reject-spec');
      load();
    } else {
      showToast(data.error, 'error');
    }
  }

  function init() {
    document.getElementById('specs-list')?.addEventListener('click', async (event) => {
      const approveBtn = event.target.closest('[data-action="approve-spec"]');
      if (approveBtn) {
        await approveOne(approveBtn);
        return;
      }

      const rejectBtn = event.target.closest('[data-action="reject-spec"]');
      if (rejectBtn) openRejectSingle(rejectBtn);
    });

    document.getElementById('specs-list')?.addEventListener('change', (event) => {
      if (event.target.id === 'spec-select-all') {
        getPendingCheckboxes().forEach((input) => {
          input.checked = event.target.checked;
        });
        updateBulkActions();
        return;
      }

      if (event.target.classList.contains('spec-approve-checkbox')) {
        updateBulkActions();
      }
    });

    document.getElementById('btn-approve-selected-specs')?.addEventListener('click', approveSelected);
    document.getElementById('btn-reject-unchecked-specs')?.addEventListener('click', openRejectUnchecked);
    document.getElementById('reject-spec-form')?.addEventListener('submit', rejectSelected);
  }

  window.ForemanSpecs = {
    configure,
    init,
    load,
  };
})();
