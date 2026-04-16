let currentUser = null;
let statsData = null;

// ─── Инициализация ────────────────────────────────────────────
async function init() {
  currentUser = await requireAuth('partner');
  if (!currentUser) return;
  document.getElementById('user-name').textContent = currentUser.name;

  // Реф. ссылка
  const refLink = `${window.location.origin}/register.html?ref=${currentUser.id}`;
  document.getElementById('ref-link').value = refLink;

  loadStats();
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
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div>
        <div style="font-family:'Stolzl',sans-serif;font-size:2rem;color:var(--accent);line-height:1">${level}</div>
        <div style="color:var(--muted);font-size:.85rem">Комиссия: <strong style="color:var(--text)">${pct}%</strong></div>
      </div>
      ${nextTarget ? `
        <div style="flex:1;min-width:200px">
          <div style="color:var(--muted);font-size:.8rem;margin-bottom:.35rem">До следующего уровня: ${nextTarget - paid} клиентов</div>
          <div style="height:6px;background:var(--border);border-radius:9999px;overflow:hidden">
            <div style="height:100%;width:${Math.min(paid/(nextTarget)*100,100)}%;background:var(--accent);border-radius:9999px"></div>
          </div>
        </div>
      ` : '<div style="color:var(--success);font-size:.9rem">Максимальный уровень!</div>'}
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
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Рефералов пока нет. Поделитесь ссылкой!</td></tr>';
    return;
  }

  tbody.innerHTML = data.data.map(r => `
    <tr>
      <td><strong>${escHtml(r.referred_name)}</strong></td>
      <td style="color:var(--muted);font-size:.85rem">${escHtml(r.referred_email)}</td>
      <td style="color:var(--muted);font-size:.85rem">${escHtml(r.referred_role)}</td>
      <td>${r.status === 'paid' ? '<span class="badge badge-green">Оплачен</span>' : '<span class="badge badge-gray">Ожидание</span>'}</td>
      <td>${r.commission > 0 ? formatMoney(r.commission) : '—'}</td>
      <td style="color:var(--muted);font-size:.85rem">${formatDate(r.created_at)}</td>
    </tr>
  `).join('');
}

// ─── Выплаты ─────────────────────────────────────────────────
async function loadPayouts() {
  const { ok, data } = await apiRequest('GET', '/api/partner/payouts');
  if (!ok) return;

  const tbody = document.querySelector('#payouts-table tbody');
  if (!data.data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Выплат пока нет</td></tr>';
    return;
  }

  tbody.innerHTML = data.data.map(p => `
    <tr>
      <td><strong>${formatMoney(p.amount)}</strong></td>
      <td style="color:var(--muted);font-size:.85rem;max-width:200px">${escHtml(p.payment_details)}</td>
      <td>${badge(p.status)}</td>
      <td style="color:var(--muted);font-size:.85rem">${formatDate(p.created_at)}</td>
      <td style="color:var(--muted);font-size:.85rem">${p.processed_at ? formatDate(p.processed_at) : '—'}</td>
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
