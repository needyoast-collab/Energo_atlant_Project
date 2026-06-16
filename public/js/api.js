// ─── API-клиент ───────────────────────────────────────────────

async function apiRequest(method, url, body = null) {
  const opts = { method, credentials: 'same-origin', headers: { 'ngrok-skip-browser-warning': '1' } };

  if (body instanceof FormData) {
    opts.body = body; // браузер сам выставит Content-Type с boundary
  } else if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();

  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? { success: true, data: null } : { success: false, error: 'Пустой ответ сервера' },
    };
  }

  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch (_) {
    return {
      ok: false,
      status: res.status,
      data: { success: false, error: 'Некорректный ответ сервера' },
    };
  }
}

// ─── Toast-уведомления ────────────────────────────────────────

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Вспомогательные ─────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(val) {
  if (val == null) return '—';
  return Number(val).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
}

const STATUS_LABELS = {
  lead: 'Лид', qualification: 'Квалификация', visit: 'Выезд',
  offer: 'КП', negotiation: 'Переговоры', contract: 'Договор',
  work: 'В работе', won: 'Завершён', lost: 'Отказ',
  new: 'Новая', in_progress: 'В работе', done: 'Выполнено', rejected: 'Отклонено',
  pending: 'Ожидание', approved: 'Одобрено', ordered: 'Заказано', delivered: 'Доставлено',
  paid: 'Оплачено', processing: 'В обработке',
};

const STATUS_BADGE = {
  lead: 'badge-gray', qualification: 'badge-blue', visit: 'badge-blue',
  offer: 'badge-yellow', negotiation: 'badge-yellow', contract: 'badge-green',
  work: 'badge-blue', won: 'badge-green', lost: 'badge-red',
  new: 'badge-blue', in_progress: 'badge-yellow', done: 'badge-green', rejected: 'badge-red',
  pending: 'badge-gray', approved: 'badge-green', ordered: 'badge-blue', delivered: 'badge-green',
  paid: 'badge-green', processing: 'badge-yellow',
};

function badge(status) {
  const label = STATUS_LABELS[status] || status;
  const cls = STATUS_BADGE[status] || 'badge-gray';
  return `<span class="badge ${cls}">${label}</span>`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}

function safeUrl(url, fallback = '#') {
  const value = String(url ?? '').trim();
  if (!value) return fallback;

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  if (value.startsWith('//')) {
    return fallback;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeAttrUrl(url, fallback = '#') {
  return escAttr(safeUrl(url, fallback));
}

// ─── Маска телефона +7 (___) ___-__-__ ───────────────────────
(function () {
  function applyPhoneMask(input) {
    if (typeof IMask !== 'function') return;
    IMask(input, {
      mask: '+{7} (000) 000-00-00',
      lazy: false,
    });
  }

  function init() {
    document.querySelectorAll('input[type="tel"], input[name="phone"]').forEach(applyPhoneMask);
    // MutationObserver для динамически добавляемых полей (модалки)
    new MutationObserver(mutations => {
      mutations.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches('input[type="tel"], input[name="phone"]')) applyPhoneMask(node);
        node.querySelectorAll && node.querySelectorAll('input[type="tel"], input[name="phone"]').forEach(applyPhoneMask);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ─── Маска кода проекта PRJ-0000-0000 ────────────────────────
(function () {
  const SEL = 'input[data-mask="project-code"]';

  function applyProjectCodeMask(input) {
    if (typeof IMask !== 'function') return;
    IMask(input, {
      mask: 'PRJ-0000-0000',
      lazy: false,
      prepare: (str) => str.toUpperCase(),
    });
    input.removeAttribute('style'); // убираем CSS text-transform:uppercase — IMask делает это сам
  }

  function init() {
    document.querySelectorAll(SEL).forEach(applyProjectCodeMask);
    new MutationObserver(mutations => {
      mutations.forEach(m => m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches(SEL)) applyProjectCodeMask(node);
        node.querySelectorAll && node.querySelectorAll(SEL).forEach(applyProjectCodeMask);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
