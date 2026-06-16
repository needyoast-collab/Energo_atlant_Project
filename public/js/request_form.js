if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

const requestForm = document.getElementById('request-form');
if (requestForm) {
  requestForm.addEventListener('submit', async (event) => {
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
    btn.textContent = 'Рассчитать стоимость работ';
  });
}
