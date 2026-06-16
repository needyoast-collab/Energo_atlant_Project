if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

document.getElementById('about-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const phoneVal = fd.get('phone') || '';
  const phoneDigits = phoneVal.replace(/\D/g, '');

  if (phoneDigits.length < 11) {
    const phoneInput = e.target.querySelector('input[name="phone"]');
    phoneInput.classList.add('is-field-invalid');
    phoneInput.focus();
    showToast('Введите полный номер телефона', 'error');
    setTimeout(() => phoneInput.classList.remove('is-field-invalid'), 2500);
    return;
  }

  const body = { name: fd.get('name') || '', phone: phoneVal, message: fd.get('message') || '' };
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  const { ok } = await apiRequest('POST', '/api/contact', body);

  if (ok) {
    showToast('Заявка отправлена, мы свяжемся с вами!', 'success');
    e.target.reset();
  } else {
    showToast('Ошибка отправки, позвоните нам', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Оставить заявку';
});
