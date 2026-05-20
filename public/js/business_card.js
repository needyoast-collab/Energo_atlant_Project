const ROLE = document.body.dataset.cardRole || '';
const DATA = {
  name: document.body.dataset.cardName || '',
  phone: document.body.dataset.cardPhone || '',
  phoneTel: document.body.dataset.cardPhoneTel || '',
  tg: document.body.dataset.cardTg || '',
  tgUser: document.body.dataset.cardTgUser || '',
  max: document.body.dataset.cardMax || '',
  maxUser: document.body.dataset.cardMaxUser || '',
  email: document.body.dataset.cardEmail || '',
  desc: document.body.dataset.cardDesc || '',
};

(function init() {
  set('c-name', DATA.name);
  set('c-phone', DATA.phone);
  set('c-email', DATA.email);
  set('c-tg', DATA.tg);

  const desc = document.getElementById('c-desc');
  if (DATA.desc) {
    desc.textContent = DATA.desc;
  } else {
    desc.classList.add('is-hidden');
  }

  if (DATA.phoneTel) lnk('lnk-phone', 'tel:' + DATA.phoneTel);
  if (DATA.email) lnk('lnk-email', 'mailto:' + DATA.email);
  if (DATA.tgUser) lnk('lnk-tg', 'https://t.me/' + DATA.tgUser);
  if (DATA.maxUser) lnk('lnk-max', DATA.maxUser);
  document.getElementById('btn-vcf').addEventListener('click', downloadVCF);
})();

function set(id, val) {
  document.getElementById(id).textContent = val;
}

function lnk(id, href) {
  document.getElementById(id).href = href;
}

function buildVCF() {
  const rows = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:' + (DATA.name || ROLE),
    'ORG:\u042D\u043D\u0435\u0440\u0433\u043E\u0410\u0442\u043B\u0430\u043D\u0442',
    'TITLE:' + ROLE,
  ];
  if (DATA.phoneTel) rows.push('TEL;TYPE=CELL:' + DATA.phoneTel);
  if (DATA.email) rows.push('EMAIL:' + DATA.email);
  if (DATA.tgUser) rows.push('URL;TYPE=Telegram:https://t.me/' + DATA.tgUser);
  if (DATA.maxUser) rows.push('URL;TYPE=MAX:https://max.ru/join/' + DATA.maxUser);
  rows.push('END:VCARD');
  return rows.join('\r\n');
}

function downloadVCF() {
  const content = buildVCF();
  const fileName = (DATA.name || ROLE).replace(/\s+/g, '_') + '.vcf';
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    window.open('data:text/vcard;charset=utf-8,' + encodeURIComponent(content), '_blank');
  } else {
    const blob = new Blob([content], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  showToast('\u2713 \u041A\u043E\u043D\u0442\u0430\u043A\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D');
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { toast.classList.add('show'); });
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.remove(); }, 300);
  }, 2500);
}
