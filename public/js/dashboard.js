// ─── Общие утилиты дашборда ───────────────────────────────────
// Подключается перед role-specific JS на каждом дашборде.

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/**
 * Инициализирует боковую навигацию.
 * @param {function(string):void} [onSection] — колбэк при переключении секции
 */
function initNav(onSection) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const section = btn.dataset.section;
      document.getElementById(`section-${section}`).classList.add('active');
      if (onSection) onSection(section);
    });
  });
}

// Закрытие модалки по клику на оверлей или кнопку [data-close]
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Выход
document.getElementById('logout-btn').addEventListener('click', async () => {
  try { await apiRequest('POST', '/api/auth/logout'); } catch (_) {}
  window.location.href = '/login.html';
});

// ─── Уведомления ─────────────────────────────────────────────

/**
 * Инициализирует колокольчик уведомлений.
 * Вызвать после auth в role-specific JS.
 */
function initNotificationBell() {
  const bellBtn  = document.getElementById('notif-bell-btn');
  const dropdown = document.getElementById('notif-dropdown');
  const badge    = document.getElementById('notif-count');
  const list     = document.getElementById('notif-list');
  const readAll  = document.getElementById('notif-read-all');

  if (!bellBtn) return; // страница без колокольчика

  let notifications = [];

  async function loadNotifications() {
    const { ok, data } = await apiRequest('GET', '/api/notifications');
    if (!ok) return;
    notifications = data.data || [];
    const unread = notifications.filter(n => !n.is_read).length;
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderNotifications() {
    if (!notifications.length) {
      list.innerHTML = '<div class="notif-empty">Нет уведомлений</div>';
      return;
    }
    list.innerHTML = notifications.slice(0, 30).map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div>${escHtml(n.message)}</div>
        <div class="notif-item-time">${formatDateTime(n.created_at)}</div>
      </div>
    `).join('');
  }

  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    if (!isOpen) {
      await loadNotifications();
      renderNotifications();
    }
    dropdown.classList.toggle('open', !isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== bellBtn) {
      dropdown.classList.remove('open');
    }
  });

  readAll.addEventListener('click', async () => {
    const unread = notifications.filter(n => !n.is_read);
    await Promise.all(unread.map(n => apiRequest('PUT', `/api/notifications/${n.id}/read`)));
    await loadNotifications();
    renderNotifications();
  });

  // Начальная загрузка счётчика
  loadNotifications();
}

// ─── Документы: технические типы ─────────────────────────────
const TECH_DOC_TYPES = {
  hidden_works_act:     'Акт скрытых работ',
  exec_scheme:          'Исполнительная схема',
  geodetic_survey:      'Геодезическая исполнительная съёмка',
  general_works_log:    'Общий журнал работ',
  author_supervision:   'Журнал авторского надзора',
  interim_acceptance:   'Акт промежуточной приёмки',
  cable_test_act:       'Акт испытания кабельной линии',
  measurement_protocol: 'Протокол измерений',
  other:                'Прочее',
};

/** Кодирует file_key в base64url для endpoint /api/documents/serve/:key */
function serveDocUrl(fileKey) {
  return '/api/documents/serve/' + btoa(fileKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Рендерит список технических документов в контейнер */
function renderTechDocs(container, docs) {
  const tech = docs.filter(d => d.doc_type in TECH_DOC_TYPES);
  if (!tech.length) {
    container.innerHTML = '<span style="color:var(--muted)">Документов нет</span>';
    return;
  }
  container.innerHTML = tech.map(doc => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:.9rem;font-weight:500">${escHtml(doc.file_name)}</div>
        <div style="color:var(--muted);font-size:.78rem">
          ${escHtml(TECH_DOC_TYPES[doc.doc_type] || doc.doc_type)} · ${escHtml(doc.uploaded_by_name)} · ${formatDate(doc.uploaded_at)}
          ${doc.description ? ' · ' + escHtml(doc.description) : ''}
        </div>
      </div>
      <a href="${serveDocUrl(doc.file_key)}" target="_blank"
         class="btn btn-outline btn-sm" style="font-size:.78rem;flex-shrink:0;margin-left:.75rem">Скачать</a>
    </div>
  `).join('');
}
