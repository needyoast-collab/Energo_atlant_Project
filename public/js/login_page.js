const ROLE_DASHBOARD = {
  admin: '/dashboard_admin.html',
  manager: '/dashboard_manager.html',
  foreman: '/dashboard_foreman.html',
  supplier: '/dashboard_supplier.html',
  pto: '/dashboard_pto.html',
  customer: '/dashboard_customer.html',
  partner: '/dashboard_partner.html',
};
const registrationVerificationState = {
  userId: null,
  type: null,
  contact: null,
  timerId: null,
  reloginAfterVerify: false,
};

// Если уже залогинен — редирект
apiRequest('GET', '/api/auth/me').then(({ ok, data }) => {
  if (ok) window.location.href = ROLE_DASHBOARD[data.data.role] || '/';
});

function setStatusClass(status, type) {
  status.classList.remove('status-muted', 'status-success', 'status-error');
  status.classList.add(type === 'error'
    ? 'status-error'
    : type === 'success'
      ? 'status-success'
      : 'status-muted');
}

document.getElementById('link-forgot').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('modal-recovery').classList.add('open');
});

document.getElementById('recovery-close').addEventListener('click', closeRecovery);
document.getElementById('btn-recovery-send').addEventListener('click', sendRecoveryCode);
document.getElementById('btn-recovery-resend').addEventListener('click', resendRecoveryCode);
document.getElementById('btn-recovery-verify').addEventListener('click', verifyRecoveryCode);
document.getElementById('btn-recovery-back').addEventListener('click', () => switchStage(1));
document.getElementById('btn-recovery-reset').addEventListener('click', resetPassword);
document.getElementById('registration-verify-close').addEventListener('click', closeRegistrationVerifyModal);
document.getElementById('registration-verify-submit').addEventListener('click', verifyRegistrationCode);
document.getElementById('registration-verify-resend').addEventListener('click', resendRegistrationCode);
window.addEventListener('resize', () => {
  const currentStep = document.getElementById('stage-3').classList.contains('is-open')
    ? 3
    : document.getElementById('stage-2').classList.contains('is-open')
      ? 2
      : 1;
  syncRecoveryLayout(currentStep);
});
updateResendUi(60);

function syncRecoveryLayout(step) {
  const overlay = document.getElementById('modal-recovery');
  overlay.classList.toggle('modal-overlay-shifted', step >= 3 || window.innerHeight < 760);
}

function setRecoveryStatus(message, type = 'muted') {
  const status = document.getElementById('recovery-send-status');
  status.textContent = message || '';
  setStatusClass(status, type);
}

function setRecoveryContactStatus(message, type = 'muted') {
  const status = document.getElementById('recovery-contact-status');
  status.textContent = message || '';
  setStatusClass(status, type);
}

function setRegistrationVerifyStatus(message, type = 'muted') {
  const status = document.getElementById('registration-verify-status');
  status.textContent = message || '';
  setStatusClass(status, type);
}

function updateRegistrationResendUi(secondsLeft) {
  const btn = document.getElementById('registration-verify-resend');
  const timer = document.getElementById('registration-verify-timer');
  if (secondsLeft > 0) {
    btn.disabled = true;
    timer.textContent = `Повторная отправка через ${secondsLeft} сек`;
  } else {
    btn.disabled = false;
    timer.textContent = 'Можно отправить код повторно';
  }
}

function stopRegistrationResendTimer() {
  if (registrationVerificationState.timerId) {
    clearInterval(registrationVerificationState.timerId);
    registrationVerificationState.timerId = null;
  }
}

function startRegistrationResendTimer(duration = 60) {
  stopRegistrationResendTimer();
  let secondsLeft = duration;
  updateRegistrationResendUi(secondsLeft);
  registrationVerificationState.timerId = setInterval(() => {
    secondsLeft -= 1;
    updateRegistrationResendUi(secondsLeft);
    if (secondsLeft <= 0) stopRegistrationResendTimer();
  }, 1000);
}

function openRegistrationVerifyModal(userData, { status, reloginAfterVerify = false } = {}) {
  registrationVerificationState.userId = userData.id;
  registrationVerificationState.type = userData.verification_type;
  registrationVerificationState.contact = userData.verification_contact;
  registrationVerificationState.reloginAfterVerify = reloginAfterVerify;

  document.getElementById('registration-verify-meta').textContent = userData.verification_type === 'phone'
    ? `Введите код подтверждения для номера ${userData.verification_contact}.`
    : `Введите код подтверждения для email ${userData.verification_contact}.`;
  setRegistrationVerifyStatus(status || 'Если код не сохранился, отправьте его заново.');
  document.getElementById('modal-registration-verify').classList.add('open');
  document.getElementById('registration-verify-code').value = '';
  document.getElementById('registration-verify-code').focus();
  updateRegistrationResendUi(0);
}

function closeRegistrationVerifyModal() {
  document.getElementById('modal-registration-verify').classList.remove('open');
  document.getElementById('registration-verify-code').value = '';
  setRegistrationVerifyStatus('');
  stopRegistrationResendTimer();
  updateRegistrationResendUi(60);
}

async function resendRegistrationCode() {
  if (!registrationVerificationState.userId) return;
  const btn = document.getElementById('registration-verify-resend');
  if (btn.disabled) return;
  btn.disabled = true;
  setRegistrationVerifyStatus('Отправляем код повторно...');

  const { ok, data } = await apiRequest('POST', '/api/auth/register/resend', {
    userId: registrationVerificationState.userId,
  });

  if (ok) {
    registrationVerificationState.type = data.data.verification_type;
    registrationVerificationState.contact = data.data.verification_contact;
    setRegistrationVerifyStatus(data.message || 'Код отправлен повторно', 'success');
    startRegistrationResendTimer(60);
  } else {
    setRegistrationVerifyStatus(data.error || 'Не удалось отправить код', 'error');
    updateRegistrationResendUi(0);
  }
}

async function verifyRegistrationCode() {
  const code = document.getElementById('registration-verify-code').value.trim();
  if (!code) {
    showToast('Введите код подтверждения', 'error');
    return;
  }

  const { ok, data } = await apiRequest('POST', '/api/auth/register/verify', {
    userId: registrationVerificationState.userId,
    code,
  });

  if (!ok) {
    setRegistrationVerifyStatus(data.error || 'Неверный код', 'error');
    return;
  }

  setRegistrationVerifyStatus('Регистрация подтверждена', 'success');
  showToast('Регистрация подтверждена', 'success');
  if (registrationVerificationState.reloginAfterVerify) {
    await loginWithCurrentForm();
  } else {
    closeRegistrationVerifyModal();
  }
}

function updateResendUi(secondsLeft) {
  const resendBtn = document.getElementById('btn-recovery-resend');
  const timer = document.getElementById('recovery-resend-timer');

  if (secondsLeft > 0) {
    resendBtn.disabled = true;
    timer.textContent = `Повторная отправка через ${secondsLeft} сек`;
  } else {
    resendBtn.disabled = false;
    timer.textContent = 'Можно отправить код повторно';
  }
}

function stopResendTimer() {
  if (window.recoveryResendTimerId) {
    window.clearInterval(window.recoveryResendTimerId);
    window.recoveryResendTimerId = null;
  }
}

function startResendTimer(duration = 60) {
  stopResendTimer();
  let secondsLeft = duration;
  updateResendUi(secondsLeft);

  window.recoveryResendTimerId = window.setInterval(() => {
    secondsLeft -= 1;
    updateResendUi(secondsLeft);

    if (secondsLeft <= 0) {
      stopResendTimer();
    }
  }, 1000);
}

function animateRecoveryCard() {
  const card = document.querySelector('.modal-card');
  card.classList.add('is-animating');
  window.clearTimeout(animateRecoveryCard.timer);
  animateRecoveryCard.timer = window.setTimeout(() => {
    card.classList.remove('is-animating');
  }, 460);
}

function closeRecovery() {
  document.getElementById('modal-recovery').classList.remove('open');
  document.getElementById('modal-recovery').classList.remove('modal-overlay-shifted');
  stopResendTimer();
  switchStage(1);
  document.getElementById('recovery-contact').value = '';
  document.getElementById('recovery-code').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-password').value = '';
  setRecoveryStatus('');
  setRecoveryContactStatus('');
  updateResendUi(60);
}

function switchStage(n) {
  animateRecoveryCard();
  document.getElementById('stage-1').classList.add('is-open');
  document.getElementById('stage-2').classList.toggle('is-open', n >= 2);
  document.getElementById('stage-3').classList.toggle('is-open', n >= 3);
  document.getElementById('recovery-send-actions').classList.toggle('is-hidden', n >= 2);
  syncRecoveryLayout(n);
}

async function requestRecoveryCode({ isResend = false } = {}) {
  const contact = document.getElementById('recovery-contact').value;
  if (!contact) return showToast('Укажите контакт', 'error');
  const sendBtn = document.getElementById('btn-recovery-send');
  const resendBtn = document.getElementById('btn-recovery-resend');

  if (!isResend) {
    setRecoveryContactStatus('Проверяем пользователя и отправляем код...');
    setRecoveryStatus('');
  } else {
    setRecoveryStatus('Отправляем код повторно...');
  }

  sendBtn.disabled = true;
  resendBtn.disabled = true;

  const { ok, data } = await apiRequest('POST', '/api/auth/forgot-password', { contact });
  if (ok) {
    if (!isResend) {
      switchStage(2);
      document.getElementById('recovery-code').focus();
    }
    setRecoveryStatus('Код отправлен. Проверьте почту или телефон.', 'success');
    setRecoveryContactStatus('');
    startResendTimer(60);
  } else {
    showToast(data.error || 'Ошибка', 'error');
    setRecoveryStatus(data.error || 'Не удалось отправить код', 'error');
    if (!isResend) {
      setRecoveryContactStatus(data.error || 'Не удалось отправить код', 'error');
    } else {
      updateResendUi(0);
    }
  }

  sendBtn.disabled = false;
}

async function sendRecoveryCode() {
  await requestRecoveryCode({ isResend: false });
}

async function resendRecoveryCode() {
  if (document.getElementById('btn-recovery-resend').disabled) return;
  await requestRecoveryCode({ isResend: true });
}

async function verifyRecoveryCode() {
  const contact = document.getElementById('recovery-contact').value;
  const code = document.getElementById('recovery-code').value;
  const { ok, data } = await apiRequest('POST', '/api/auth/verify-code', { contact, code });
  if (ok) {
    showToast(data.message || 'Код подтвержден', 'success');
    switchStage(3);
    document.getElementById('new-password').focus();
  } else {
    showToast(data.error || 'Неверный код', 'error');
  }
}

async function resetPassword() {
  const contact = document.getElementById('recovery-contact').value;
  const code = document.getElementById('recovery-code').value;
  const password = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;

  if (password !== confirm) return showToast('Пароли не совпадают', 'error');
  if (password.length < 8) return showToast('Пароль слишком короткий', 'error');

  const { ok, data } = await apiRequest('POST', '/api/auth/reset-password', { contact, code, password });
  if (ok) {
    showToast('Пароль изменен! Войдите в систему', 'success');
    closeRecovery();
    if (data.data?.requiresVerification) {
      openRegistrationVerifyModal(data.data, {
        status: 'Пароль изменён. Осталось подтвердить регистрацию.',
      });
    }
  } else {
    showToast(data.error || 'Ошибка', 'error');
  }
}

async function loginWithCurrentForm() {
  const form = document.getElementById('login-form');
  const fd = new FormData(form);
  const { ok, data } = await apiRequest('POST', '/api/auth/login', Object.fromEntries(fd.entries()));
  if (ok) {
    window.location.href = ROLE_DASHBOARD[data.data.role] || '/';
  }
  return ok;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Вход...';

  const { ok, data } = await apiRequest('POST', '/api/auth/login', Object.fromEntries(fd.entries()));

  if (ok) {
    window.location.href = ROLE_DASHBOARD[data.data.role] || '/';
  } else {
    if (data.data?.requiresVerification) {
      openRegistrationVerifyModal(data.data, {
        status: 'Аккаунт найден, но регистрация ещё не подтверждена.',
        reloginAfterVerify: true,
      });
    } else {
      showToast(data.error || 'Ошибка входа', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
});

function resetLoginFormState() {
  const form = document.getElementById('login-form');
  const btn = form?.querySelector('button[type=submit]');
  if (!form || !btn) return;

  form.reset();
  btn.disabled = false;
  btn.textContent = 'Войти';
}

window.addEventListener('pageshow', (event) => {
  const navigationEntry = performance.getEntriesByType('navigation')[0];
  const isBackForward = navigationEntry?.type === 'back_forward';
  if (event.persisted || isBackForward) {
    resetLoginFormState();
  }
});
  
