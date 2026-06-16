// ─── Общие утилиты дашборда ───────────────────────────────────
// Подключается перед role-specific JS на каждом дашборде.

function openModal(id)  {
  const modal = document.getElementById(id);
  modal.classList.add('open');
}
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

function renderUserAvatar(user) {
  const container = document.getElementById('sidebar-avatar');
  if (!container || !user) return;

  const avatarUrl = safeUrl(user.avatar_url, '');
  if (avatarUrl) {
    container.textContent = '';
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = '';
    container.appendChild(img);
    return;
  }

  const initials = String(user.name || user.login || user.email || '—')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  container.textContent = initials || '—';
}

// Закрытие модалки по клику на оверлей или кнопку [data-close]
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Автоскрываемые скроллбары в больших модалках/таблицах
document.querySelectorAll('.autohide-scroll').forEach((el) => {
  let scrollTimer = null;
  el.addEventListener('scroll', () => {
    el.classList.add('scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => el.classList.remove('scrolling'), 650);
  }, { passive: true });
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
      <div class="notif-item ${n.is_read ? '' : 'unread'}"
           data-id="${n.id}"
           data-type="${escHtml(n.type || '')}"
           data-project-id="${n.project_id || ''}"
           data-entity-type="${escHtml(n.entity_type || '')}"
           data-entity-id="${n.entity_id || ''}"
           data-message="${escHtml(n.message || '')}">
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

  list.addEventListener('click', async (e) => {
    const item = e.target.closest('.notif-item');
    if (!item) return;

    const notification = notifications.find(n => String(n.id) === item.dataset.id);
    if (!notification) return;

    if (!notification.is_read) {
      await apiRequest('PUT', `/api/notifications/${notification.id}/read`);
      notification.is_read = true;
      item.classList.remove('unread');
      const unread = notifications.filter(n => !n.is_read).length;
      if (unread > 0) badge.textContent = unread > 99 ? '99+' : unread;
      else badge.classList.add('hidden');
    }

    if (notification.project_id) {
      dropdown.classList.remove('open');
      document.dispatchEvent(new CustomEvent('notification:open', { detail: notification }));
    }
  });

  // Начальная загрузка счётчика
  loadNotifications();
}

// ─── Общие справочники ───────────────────────────────────────
window.PROJECT_DOC_LABELS = Object.freeze({
  hidden_works_act:     'Акт скрытых работ',
  exec_scheme:          'Исполнительная схема',
  geodetic_survey:      'Геодезическая исполнительная съёмка',
  general_works_log:    'Общий журнал работ',
  author_supervision:   'Журнал авторского надзора',
  interim_acceptance:   'Акт промежуточной приёмки',
  cable_test_act:       'Акт испытания кабельной линии',
  measurement_protocol: 'Протокол измерений',
  rd:                   'Рабочая документация (РД)',
  tu:                   'Технические условия (ТУ)',
  pd:                   'Проектная документация (ПД)',
  tz:                   'Техническое задание (ТЗ)',
  construction_permit:  'Разрешение на строительство',
  arbp:                 'Акт разграничения балансовой принадлежности',
  kp:                   'Коммерческое предложение (КП)',
  estimate:             'Смета / локальный сметный расчёт',
  contract:             'Договор подряда',
  additional_agreement: 'Дополнительное соглашение',
  ks2:                  'Акт выполненных работ (КС-2)',
  ks3:                  'Справка о стоимости (КС-3)',
  other:                'Прочее',
});

window.TECHNICAL_DOC_TYPES = Object.freeze([
  'rd',
  'tu',
  'pd',
  'tz',
  'construction_permit',
  'arbp',
  'exec_scheme',
  'hidden_works_act',
  'geodetic_survey',
  'general_works_log',
  'author_supervision',
  'interim_acceptance',
  'cable_test_act',
  'measurement_protocol',
  'other',
]);

window.FINANCIAL_DOC_TYPES = Object.freeze([
  'kp',
  'estimate',
  'contract',
  'additional_agreement',
  'ks2',
  'ks3',
]);

window.REQUEST_DOC_LABELS = Object.freeze({
  tu: 'Технические условия',
  rd: 'Рабочая документация',
  pd: 'Проектная документация',
  tz: 'Техническое задание',
  situation_plan: 'Ситуационный план',
  other: 'Прочее',
});

const TECH_DOC_TYPES = Object.fromEntries(
  window.TECHNICAL_DOC_TYPES.map((type) => [type, window.PROJECT_DOC_LABELS[type]])
);

/** Кодирует file_key в base64url для endpoint /api/documents/serve/:key */
function serveDocUrl(fileKey) {
  const bytes = new TextEncoder().encode(String(fileKey ?? ''));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return '/api/documents/serve/' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Рендерит список технических документов в контейнер */
function renderTechDocs(container, docs) {
  const tech = docs.filter(d => d.doc_type in TECH_DOC_TYPES);
  if (!tech.length) {
    container.innerHTML = '<span class="text-muted">Документов нет</span>';
    return;
  }
  container.innerHTML = tech.map(doc => `
    <div class="tech-doc-row">
      <div>
        <div class="tech-doc-title">${escHtml(doc.file_name)}</div>
        <div class="tech-doc-meta">
          ${escHtml(doc.doc_label || TECH_DOC_TYPES[doc.doc_type] || doc.doc_type)} · ${escHtml(doc.uploaded_by_name)} · ${formatDate(doc.uploaded_at)}
          ${doc.description ? ' · ' + escHtml(doc.description) : ''}
        </div>
      </div>
      <a href="${safeAttrUrl(doc.url || serveDocUrl(doc.file_key))}" target="_blank"
         rel="noopener" class="btn btn-outline btn-sm tech-doc-download">Скачать</a>
    </div>
  `).join('');
}
