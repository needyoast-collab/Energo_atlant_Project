if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

document.querySelectorAll('.service-nav-card[data-target]').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.service-nav-card').forEach((item) => item.classList.remove('active'));
    card.classList.add('active');
    const target = document.getElementById(card.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.getElementById('request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.target);
  const body = { message: fd.get('message') || '' };
  if (fd.get('name')) body.name = fd.get('name');
  if (fd.get('phone')) body.phone = fd.get('phone');
  if (fd.get('email')) body.email = fd.get('email');

  const btn = event.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправка...';
  const { ok, data } = await apiRequest('POST', '/api/public/requests', body);
  if (ok) {
    showToast('Заявка отправлена! Перезвоним в течение 2 часов.', 'success');
    event.target.reset();
  } else {
    showToast(data.error || 'Ошибка отправки', 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Отправить заявку';
});
