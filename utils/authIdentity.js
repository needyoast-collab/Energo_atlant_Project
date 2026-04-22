function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLogin(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  const normalizedDigits = normalizePhoneDigits(value);

  if (!normalizedDigits) {
    return '';
  }

  return `+7 (${normalizedDigits.slice(1, 4)}) ${normalizedDigits.slice(4, 7)}-${normalizedDigits.slice(7, 9)}-${normalizedDigits.slice(9, 11)}`;
}

function normalizePhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) return '';

  let normalizedDigits = digits;

  if (normalizedDigits.length === 11 && normalizedDigits.startsWith('8')) {
    normalizedDigits = `7${normalizedDigits.slice(1)}`;
  } else if (normalizedDigits.length === 10 && normalizedDigits.startsWith('9')) {
    normalizedDigits = `7${normalizedDigits}`;
  }

  if (normalizedDigits.length !== 11 || !normalizedDigits.startsWith('7')) {
    return '';
  }

  return normalizedDigits;
}

function normalizeAuthContact(value) {
  const raw = String(value || '').trim();
  const normalizedPhone = normalizePhone(raw);

  if (normalizedPhone) {
    return {
      type: 'phone',
      raw,
      normalized: normalizedPhone,
    };
  }

  if (raw.includes('@')) {
    return {
      type: 'email',
      raw,
      normalized: normalizeEmail(raw),
    };
  }

  return {
    type: 'login',
    raw,
    normalized: normalizeLogin(raw),
  };
}

function isValidPhone(value) {
  return Boolean(normalizePhone(value));
}

module.exports = {
  normalizeEmail,
  normalizeLogin,
  normalizePhone,
  normalizePhoneDigits,
  normalizeAuthContact,
  isValidPhone,
};
