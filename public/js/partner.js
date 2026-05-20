let currentUser = null;
let statsData = null;

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  try {
    currentUser = await requireAuth(window.APP_ROLES.PARTNER);
    if (!currentUser) return;
    document.getElementById('user-name').textContent = currentUser.name;
    renderUserAvatar(currentUser);

    // Реф. ссылка
    const refLink = `${window.location.origin}/register.html?ref=${currentUser.id}`;
    document.getElementById('ref-link').value = refLink;

    await loadStats();
  } finally {
    window.hidePreloader?.();
  }
}

// ─── Навигация ────────────────────────────────────────────────
initNav(section => {
  if (section === 'refs')    loadRefs();
  if (section === 'payouts') loadPayouts();
});

// ─── Статистика ───────────────────────────────────────────────
async function loadStats() {
  const { ok, data } = await apiRequest('GET', '/api/partner/stats');
  if (!ok) return;
  statsData = data.data;

  document.getElementById('stat-refs').textContent      = statsData.refs_total;
  document.getElementById('stat-refs-paid').textContent  = statsData.refs_paid;
  document.getElementById('stat-earned').textContent     = formatMoney(statsData.earned);
  document.getElementById('stat-pending').textContent    = formatMoney(statsData.pending_total);

  // Уровень
  const paid = statsData.refs_paid;
  let level, pct, nextTarget;
  if (paid >= 15)     { level = 'Эксперт'; pct = 15; nextTarget = null; }
  else if (paid >= 8) { level = 'Профи';   pct = 12; nextTarget = 15; }
  else if (paid >= 3) { level = 'Базовый'; pct = 8;  nextTarget = 8; }
  else                { level = 'Старт';   pct = 5;  nextTarget = 3; }

  document.getElementById('level-info').innerHTML = `
    <div class="partner-level-summary">
      <div>
        <div class="partner-level-title">${level}</div>
        <div class="partner-level-meta">Комиссия: <strong>${pct}%</strong></div>
      </div>
      ${nextTarget ? `
        <div class="partner-level-next">
          <div class="partner-level-next-label">До следующего уровня: ${nextTarget - paid} клиентов</div>
          <progress class="partner-level-progress" value="${paid}" max="${nextTarget}"></progress>
        </div>
      ` : '<div class="partner-level-max">Максимальный уровень!</div>'}
    </div>
  `;

  // Подсветка активного уровня
  const tileMap = { 'Старт': 'level-start', 'Базовый': 'level-base', 'Профи': 'level-pro', 'Эксперт': 'level-expert' };
  document.querySelectorAll('.level-tile').forEach(t => t.classList.remove('active'));
  document.getElementById(tileMap[level])?.classList.add('active');
}

// ─── Копировать ссылку ────────────────────────────────────────
document.getElementById('btn-copy-link').addEventListener('click', () => {
  const input = document.getElementById('ref-link');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Ссылка скопирована', 'success');
  });
});

// ─── Рефералы ─────────────────────────────────────────────────
async function loadRefs() {
  const { ok, data } = await apiRequest('GET', '/api/partner/refs');
  if (!ok) return;

  const tbody = document.querySelector('#refs-table tbody');
  if (!data.data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Рефералов пока нет. Поделитесь ссылкой!</td></tr>';
    return;
  }

  tbody.innerHTML = data.data.map(r => `
    <tr>
      <td><strong>${escHtml(r.referred_name)}</strong></td>
      <td class="partner-table-muted">${escHtml(r.referred_email)}</td>
      <td class="partner-table-muted">${escHtml(r.referred_role)}</td>
      <td>${r.status === 'paid' ? '<span class="badge badge-green">Оплачен</span>' : '<span class="badge badge-gray">Ожидание</span>'}</td>
      <td>${r.commission > 0 ? formatMoney(r.commission) : '—'}</td>
      <td class="partner-table-muted">${formatDate(r.created_at)}</td>
    </tr>
  `).join('');
}

// ─── Выплаты ─────────────────────────────────────────────────
async function loadPayouts() {
  const { ok, data } = await apiRequest('GET', '/api/partner/payouts');
  if (!ok) return;

  const tbody = document.querySelector('#payouts-table tbody');
  if (!data.data.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Выплат пока нет</td></tr>';
    return;
  }

  tbody.innerHTML = data.data.map(p => `
    <tr>
      <td><strong>${formatMoney(p.amount)}</strong></td>
      <td class="partner-table-muted partner-payout-details">${escHtml(p.payment_details)}</td>
      <td>${badge(p.status)}</td>
      <td class="partner-table-muted">${formatDate(p.created_at)}</td>
      <td class="partner-table-muted">${p.processed_at ? formatDate(p.processed_at) : '—'}</td>
    </tr>
  `).join('');
}

document.getElementById('btn-request-payout').addEventListener('click', () => {
  document.getElementById('payout-form').reset();
  openModal('modal-payout');
});

document.getElementById('payout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    amount: parseFloat(fd.get('amount')),
    payment_details: fd.get('payment_details'),
  };

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const { ok, data } = await apiRequest('POST', '/api/partner/payout-request', body);
  btn.disabled = false;

  if (ok) {
    showToast('Запрос на выплату отправлен', 'success');
    closeModal('modal-payout');
    loadPayouts();
  } else showToast(data.error, 'error');
});

init();
