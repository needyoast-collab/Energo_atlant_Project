if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

document.getElementById('request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.target);

  const phoneVal = fd.get('phone') || '';
  const phoneDigits = phoneVal.replace(/\D/g, '');
  if (phoneDigits.length < 11) {
    const phoneInput = event.target.querySelector('input[name="phone"]');
    phoneInput.classList.add('is-field-invalid');
    phoneInput.focus();
    showToast('Введите полный номер телефона', 'error');
    setTimeout(() => { phoneInput.classList.remove('is-field-invalid'); }, 2500);
    return;
  }

  const body = { message: fd.get('message') || '' };
  if (fd.get('name')) body.name = fd.get('name');
  body.phone = phoneVal;
  if (fd.get('email')) body.email = fd.get('email');

  const btn = event.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  const { ok } = await apiRequest('POST', '/api/contact', body);

  if (ok) {
    event.target.classList.add('is-hidden');
    document.getElementById('form-success').classList.add('is-block');
  } else {
    showToast('Ошибка отправки, позвоните нам', 'error');
    btn.disabled = false;
    btn.textContent = 'Отправить заявку';
  }
});
