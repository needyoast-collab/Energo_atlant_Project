// ─── Формирование и отправка КП менеджера ─────────────────────
(function () {
  let currentKpData = null;
  const state = {
    getActiveProjectId: () => null,
    onSent: async () => {},
  };

  function configure(options = {}) {
    Object.assign(state, options);
  }

  function getActiveProjectId() {
    return state.getActiveProjectId?.() || null;
  }

  function numberToWordsRu(num) {
    if (num === 0) return 'ноль';
    const units = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    const unitsF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    const forms = [
      ['', '', ''],
      ['тысяча', 'тысячи', 'тысяч'],
      ['миллион', 'миллиона', 'миллионов'],
      ['миллиард', 'миллиарда', 'миллиардов'],
    ];
    let n = Math.floor(num);
    let words = [];
    let group = 0;

    function getPlural(value, formArr) {
      const n10 = value % 10;
      const n100 = value % 100;
      if (n100 > 10 && n100 < 20) return formArr[2];
      if (n10 > 1 && n10 < 5) return formArr[1];
      if (n10 === 1) return formArr[0];
      return formArr[2];
    }

    while (n > 0) {
      const chunk = n % 1000;
      if (chunk !== 0) {
        const chunkWords = [];
        const h = Math.floor(chunk / 100);
        const t = Math.floor((chunk % 100) / 10);
        const u = chunk % 10;

        if (h > 0) chunkWords.push(hundreds[h]);
        if (t === 1) {
          chunkWords.push(teens[u]);
        } else {
          if (t > 1) chunkWords.push(tens[t]);
          if (u > 0) chunkWords.push(group === 1 ? unitsF[u] : units[u]);
        }
        const form = getPlural(chunk, forms[group]);
        if (form) chunkWords.push(form);
        words = chunkWords.concat(words);
      }
      n = Math.floor(n / 1000);
      group++;
    }
    return words.join(' ').trim();
  }

  function getAvailability(payload) {
    const hasWorks = (payload.works || []).length > 0;
    const requiresMaterials = !!payload.project.include_materials;
    const hasMaterials = (payload.materials || []).length > 0;

    if (!hasWorks) {
      return { disabled: true, reason: 'Для формирования КП нужно добавить хотя бы одну позицию ВОР' };
    }

    if (requiresMaterials && !hasMaterials) {
      return { disabled: true, reason: 'Для формирования КП нужно заполнить ВОМ или отметить, что материалы не требуются' };
    }

    return { disabled: false, reason: '' };
  }

  function syncActionVisibility(isVisible) {
    const action = document.getElementById('estimate-kp-action');
    if (action) action.classList.toggle('is-hidden', !isVisible);
  }

  async function refreshButtonState(projectId) {
    if (!projectId) return;

    const kpBtn = document.getElementById('btn-open-kp');
    if (!kpBtn) return;
    if (kpBtn.classList.contains('is-hidden')) {
      syncActionVisibility(false);
      return;
    }

    const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/kp-data`);
    if (!ok) {
      kpBtn.disabled = true;
      kpBtn.title = data.error || 'Не удалось проверить данные для КП';
      syncActionVisibility(true);
      return;
    }

    const availability = getAvailability(data.data);
    kpBtn.disabled = availability.disabled;
    kpBtn.title = availability.reason || '';
    syncActionVisibility(true);
  }

  async function openKpModal() {
    const kpBtn = document.getElementById('btn-open-kp');
    if (!kpBtn || kpBtn.disabled) return;

    const projectId = getActiveProjectId();
    if (!projectId) return;

    const container = document.getElementById('kp-preview-content');
    container.innerHTML = '<span class="text-muted">Сбор данных для КП...</span>';
    document.getElementById('kp-markup-input').value = '0';
    document.getElementById('kp-final-sum-label').textContent = '0';
    document.getElementById('kp-manual-file').value = '';

    openModal('modal-generate-kp');

    const { ok, data } = await apiRequest('GET', `/api/manager/projects/${projectId}/kp-data`);
    if (!ok) {
      container.innerHTML = `<span class="text-danger">Ошибка: ${escHtml(data.error || 'Не удалось загрузить данные')}</span>`;
      return;
    }

    const payload = data.data;
    const availability = getAvailability(payload);
    if (availability.disabled) {
      container.innerHTML = `<strong>${escHtml(availability.reason)}</strong>`;
      kpBtn.disabled = true;
      kpBtn.title = availability.reason;
      return;
    }

    const regionalCoeff = Number(payload.project.regional_coeff || 1);

    let worksTotal = 0;
    payload.works.forEach((work) => {
      work.effective_price = Number(work.effective_price || 0);
      work.total = parseFloat((work.quantity * work.effective_price * regionalCoeff).toFixed(2));
      worksTotal += work.total;
    });

    let materialsTotal = 0;
    if (payload.project.include_materials) {
      payload.materials.forEach((material) => {
        material.unit_price = Number(material.unit_price || 0);
        material.total = parseFloat((material.quantity * material.unit_price).toFixed(2));
        materialsTotal += material.total;
      });
    }

    const baseSum = parseFloat((worksTotal + materialsTotal).toFixed(2));
    currentKpData = {
      date: new Date().toLocaleDateString('ru-RU'),
      customerName: payload.project.contact_name || 'Не указан',
      projectName: payload.project.name,
      projectAddress: payload.project.address || 'Не указан',
      projectCode: payload.project.code,
      include_materials: payload.project.include_materials,
      regionalCoeff,
      works: payload.works,
      materials: payload.materials,
      worksTotal,
      materialsTotal,
      baseSum,
      baseSumWords: numberToWordsRu(baseSum),
      finalSum: baseSum,
      finalSumWords: numberToWordsRu(baseSum),
    };

    renderPreview();
  }

  function renderPreview() {
    if (!currentKpData) return;

    const markup = parseFloat(document.getElementById('kp-markup-input').value) || 0;
    currentKpData.finalSum = parseFloat((currentKpData.baseSum + markup).toFixed(2));
    currentKpData.finalSumWords = numberToWordsRu(currentKpData.finalSum);

    document.getElementById('kp-final-sum-label').textContent = formatMoney(currentKpData.finalSum);

    const container = document.getElementById('kp-preview-content');
    container.innerHTML = `
      <div class="manager-kp-preview-doc">
        <div class="manager-kp-preview-meta">
          Исх. № <strong>будет присвоен при отправке</strong><br>
          Дата: <strong>${currentKpData.date}</strong>
        </div>
        <h2 class="manager-kp-preview-title">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</h2>

        <p class="manager-kp-preview-p">
          ИП Большакова Е.Ф. рассмотрело техническое задание на выполнение строительно-монтажных работ по <strong>"${escHtml(currentKpData.projectName)}"</strong> по адресу <strong>${escHtml(currentKpData.projectAddress)}</strong> и готово принять данный объём в работу в полном соответствии с предъявленными требованиями.
        </p>

        <p class="manager-kp-preview-p is-compact"><strong>Стоимость и условия:</strong></p>
        <p class="manager-kp-preview-p is-compact">
          Общая стоимость работ составляет <strong>${formatMoney(currentKpData.finalSum)}</strong> (<strong>${currentKpData.finalSumWords}</strong>) руб., включая НДС 20%.
        </p>
        <p class="manager-kp-preview-p manager-kp-preview-section">
          Детальная ведомость объемов работ ${currentKpData.include_materials ? 'и материалов ' : ''}с разбивкой по позициям приведена ниже.
        </p>

        <div class="manager-kp-preview-section">
          <div class="manager-kp-preview-section-title">Ведомость работ</div>
          <table class="manager-kp-preview-table">
            <thead>
              <tr>
                <th>Работа</th>
                <th class="num">Кол-во</th>
                <th>Ед.</th>
                <th class="num">Цена</th>
                <th class="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              ${currentKpData.works.map((work) => `
                <tr>
                  <td>${escHtml(work.work_name)}</td>
                  <td class="num">${work.quantity}</td>
                  <td>${escHtml(work.unit || '—')}</td>
                  <td class="num">${work.effective_price ? formatMoney(work.effective_price) : '0 ₽'}</td>
                  <td class="num strong">${formatMoney(work.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        ${currentKpData.include_materials ? `
          <div class="manager-kp-preview-section">
            <div class="manager-kp-preview-section-title">Ведомость материалов</div>
            <table class="manager-kp-preview-table">
              <thead>
                <tr>
                  <th>Материал</th>
                  <th class="num">Кол-во</th>
                  <th>Ед.</th>
                  <th class="num">Цена</th>
                  <th class="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                ${currentKpData.materials.map((material) => `
                  <tr>
                    <td>${escHtml(material.material_name)}</td>
                    <td class="num">${material.quantity}</td>
                    <td>${escHtml(material.unit || '—')}</td>
                    <td class="num">${material.unit_price ? formatMoney(material.unit_price) : '0 ₽'}</td>
                    <td class="num strong">${formatMoney(material.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="manager-kp-preview-note">
            Материалы не включены в КП для этого проекта.
          </div>
        `}

        <div class="manager-kp-preview-totals">
          <div>Работы: <strong>${formatMoney(currentKpData.worksTotal)}</strong></div>
          ${currentKpData.include_materials ? `<div>Материалы: <strong>${formatMoney(currentKpData.materialsTotal)}</strong></div>` : ''}
          ${currentKpData.regionalCoeff !== 1 ? `<div>Региональный коэффициент для работ: <strong>${currentKpData.regionalCoeff}</strong></div>` : ''}
          ${markup ? `<div>Ручная корректировка: <strong>${formatMoney(markup)}</strong></div>` : ''}
        </div>

        <div class="manager-kp-preview-footnote">
          <em>* Предпросмотр перед отправкой. Итоговый документ будет сформирован из Word-шаблона и сохранён в документах проекта.</em>
        </div>
      </div>
    `;
  }

  async function downloadWord() {
    if (!currentKpData) return;
    const projectId = getActiveProjectId();
    if (!projectId) return;

    const btn = document.getElementById('btn-kp-download');
    btn.disabled = true;
    btn.textContent = 'Подготовка...';

    try {
      const res = await fetch(`/api/manager/projects/${projectId}/kp-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentKpData),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = currentKpData.projectName.replace(/[/\\?%*:|"<>]/g, '_');
        a.download = `КП_${safeName}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        const data = await res.json();
        showToast(data.error || 'Ошибка скачивания', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Сетевая ошибка', 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Скачать Word (.docx)';
  }

  async function sendKp() {
    if (!currentKpData) return;
    const projectId = getActiveProjectId();
    if (!projectId) return;

    const btn = document.getElementById('btn-kp-send');
    btn.disabled = true;
    btn.textContent = 'Отправка...';

    const fd = new FormData();
    const fileInput = document.getElementById('kp-manual-file');
    if (fileInput.files.length > 0) {
      fd.append('file', fileInput.files[0]);
    } else {
      fd.append('kpData', JSON.stringify(currentKpData));
    }

    try {
      const { ok, data } = await apiRequest('POST', `/api/manager/projects/${projectId}/kp-send`, fd);
      if (ok) {
        showToast(data.message || 'Коммерческое предложение отправлено!', 'success');
        closeModal('modal-generate-kp');
        await state.onSent?.({
          projectId,
          sentAt: new Date().toISOString().slice(0, 10),
          data,
        });
      } else {
        showToast(data.error || 'Ошибка при отправке', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Сетевая ошибка', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Отправить Заказчику';
    }
  }

  function init() {
    document.getElementById('btn-open-kp')?.addEventListener('click', openKpModal);
    document.getElementById('kp-markup-input')?.addEventListener('input', renderPreview);
    document.getElementById('btn-kp-download')?.addEventListener('click', downloadWord);
    document.getElementById('btn-kp-send')?.addEventListener('click', sendKp);
  }

  window.ManagerKp = {
    configure,
    init,
    refreshButtonState,
    syncActionVisibility,
  };
})();
