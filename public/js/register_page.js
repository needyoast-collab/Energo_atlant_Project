const registerVerificationState = {
  userId: null,
  type: null,
  contact: null,
  timerId: null,
};

// Переключение роли
document.querySelectorAll('[data-role]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-role]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector('[name=role]').value = tab.dataset.role;
  });
});

function setStatusClass(status, type) {
  status.classList.remove('status-muted', 'status-success', 'status-error');
  status.classList.add(type === 'error'
    ? 'status-error'
    : type === 'success'
      ? 'status-success'
      : 'status-muted');
}

function setVerifyStatus(message, type = 'muted') {
  const status = document.getElementById('register-verify-status');
  status.textContent = message || '';
  setStatusClass(status, type);
}

function updateVerifyResend(secondsLeft) {
  const btn = document.getElementById('register-verify-resend');
  const timer = document.getElementById('register-verify-timer');
  if (secondsLeft > 0) {
    btn.disabled = true;
    timer.textContent = `Повторная отправка через ${secondsLeft} сек`;
  } else {
    btn.disabled = false;
    timer.textContent = 'Можно отправить код повторно';
  }
}

function stopVerifyTimer() {
  if (registerVerificationState.timerId) {
    clearInterval(registerVerificationState.timerId);
    registerVerificationState.timerId = null;
  }
}

function startVerifyTimer(duration = 60) {
  stopVerifyTimer();
  let secondsLeft = duration;
  updateVerifyResend(secondsLeft);
  registerVerificationState.timerId = setInterval(() => {
    secondsLeft -= 1;
    updateVerifyResend(secondsLeft);
    if (secondsLeft <= 0) stopVerifyTimer();
  }, 1000);
}

function closeVerifyModal() {
  document.getElementById('register-verify-modal').classList.remove('open');
  document.getElementById('register-verify-code').value = '';
  setVerifyStatus('');
  stopVerifyTimer();
  updateVerifyResend(60);
}

async function resendVerifyCode() {
  if (!registerVerificationState.userId) return;
  const btn = document.getElementById('register-verify-resend');
  if (btn.disabled) return;
  btn.disabled = true;
  setVerifyStatus('Отправляем код повторно...');
  const { ok, data } = await apiRequest('POST', '/api/auth/register/resend', { userId: registerVerificationState.userId });
  if (ok) {
    setVerifyStatus(data.message || 'Код отправлен повторно', 'success');
    startVerifyTimer(60);
  } else {
    setVerifyStatus(data.error || 'Не удалось отправить код', 'error');
    updateVerifyResend(0);
  }
}

async function verifyRegistrationCode() {
  const code = document.getElementById('register-verify-code').value.trim();
  if (!code) {
    showToast('Введите код подтверждения', 'error');
    return;
  }
  const { ok, data } = await apiRequest('POST', '/api/auth/register/verify', {
    userId: registerVerificationState.userId,
    code,
  });
  if (ok) {
    setVerifyStatus('Регистрация подтверждена. Теперь можно войти.', 'success');
    showToast('Регистрация подтверждена', 'success');
    setTimeout(() => {
      closeVerifyModal();
      window.location.href = '/login.html';
    }, 700);
  } else {
    setVerifyStatus(data.error || 'Неверный код', 'error');
  }
}

document.getElementById('register-verify-close').addEventListener('click', closeVerifyModal);
document.getElementById('register-verify-submit').addEventListener('click', verifyRegistrationCode);
document.getElementById('register-verify-resend').addEventListener('click', resendVerifyCode);

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const lastName = String(fd.get('last_name') || '').trim();
  const firstName = String(fd.get('first_name') || '').trim();
  const patronymic = String(fd.get('patronymic') || '').trim();
  const phone = String(fd.get('phone') || '');
  const email = String(fd.get('email') || '').trim();
  const phoneDigits = phone.replace(/\D/g, '');
  const fullName = [lastName, firstName, patronymic].filter(Boolean).join(' ');

  if (!lastName || !firstName || !patronymic) {
    showToast('Укажите фамилию, имя и отчество', 'error');
    e.target.querySelector(!lastName ? '[name=last_name]' : !firstName ? '[name=first_name]' : '[name=patronymic]').focus();
    return;
  }

  if (!email && !phoneDigits) {
    showToast('Укажите email или телефон', 'error');
    e.target.querySelector('[name=email]').focus();
    return;
  }

  if (phone && (phoneDigits.length !== 11 || !['7', '8'].includes(phoneDigits[0]))) {
    showToast('Укажите телефон в формате +7 (9XX) XXX-XX-XX', 'error');
    e.target.querySelector('[name=phone]').focus();
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  const payload = Object.fromEntries(fd.entries());
  payload.name = fullName;
  delete payload.first_name;
  delete payload.last_name;
  delete payload.patronymic;

  const { ok, data } = await apiRequest('POST', '/api/auth/register', payload);

  if (ok) {
    registerVerificationState.userId = data.data.id;
    registerVerificationState.type = data.data.verification_type;
    registerVerificationState.contact = data.data.verification_contact;
    document.getElementById('register-verify-meta').textContent = data.data.verification_type === 'phone'
      ? `Мы отправили код подтверждения на номер ${data.data.verification_contact}.`
      : `Мы отправили код подтверждения на email ${data.data.verification_contact}.`;
    setVerifyStatus(data.message || 'Код подтверждения отправлен', 'success');
    document.getElementById('register-verify-modal').classList.add('open');
    document.getElementById('register-verify-code').focus();
    startVerifyTimer(60);
    e.target.reset();
    document.querySelectorAll('[data-role]').forEach((t, i) => t.classList.toggle('active', i === 0));
    document.querySelector('[name=role]').value = 'customer';
  } else {
    showToast(data.error || 'Ошибка регистрации', 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Зарегистрироваться';
});
  
