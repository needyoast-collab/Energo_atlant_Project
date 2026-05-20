if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

document.querySelectorAll('.hero-video, .hero-video-mobile').forEach((video) => {
  video.muted = true;
  video.play().catch(() => {});
});

const SERVICES = {
  '1': {
    badge: 'Воздушные линии',
    title: 'Воздушные линии электропередачи',
    desc: 'Монтаж ВЛ 0.4–110 кВ на деревянных, металлических и железобетонных опорах. Выполняем раскатку и натяжку провода, монтаж защитных тросов, устройство заземляющих контуров.',
    list: ['Монтаж опор ВЛ 0.4 / 6 / 10 / 35 / 110 кВ', 'Раскатка, натяжка и подвеска провода', 'Монтаж защитных тросов и опасных переходов', 'Устройство заземления и молниезащиты', 'Измерения: изоляция, сопротивление ЗУ'],
    slides: ['ВЛ 0.4 кВ', 'ВЛ 10 кВ', 'ВЛ 110 кВ'],
  },
  '2': {
    badge: 'Кабельные линии',
    title: 'Кабельные линии',
    desc: 'Прокладка кабеля в земле, кабельных лотках, трубах и блочной канализации. Монтаж концевых и соединительных муфт. Испытания КЛ повышенным напряжением. ГНБ под дорогами без вскрытия грунта.',
    list: ['Прокладка КЛ в траншеях и кабельных блоках', 'ГНБ под дорогами, реками, зданиями', 'Монтаж концевых и соединительных муфт', 'Прокладка в лотках, коробах, трубах', 'Испытания ПНН, измерение ЧР'],
    slides: ['КЛ в траншее', 'ГНБ', 'Муфты'],
  },
  '3': {
    badge: 'Подстанции',
    title: 'Трансформаторные подстанции',
    desc: 'Монтаж комплектных трансформаторных подстанций всех типов: КТП, БКТП, ЗТП, РТП, МТП. Подключение силовых трансформаторов, сборка высоковольтных ячеек. ПНР и испытания.',
    list: ['Монтаж КТП, БКТП, ЗТП 10/0.4 кВ', 'Подключение трансформаторов 25–1600 кВА', 'Сборка ячеек РУВН и РУНН', 'Монтаж систем учёта и защиты', 'ПНР и испытания оборудования'],
    slides: ['КТП 10/0.4 кВ', 'БКТП', 'ЗТП'],
  },
  '4': {
    badge: 'Электроснабжение',
    title: 'Электроснабжение объектов',
    desc: 'Монтаж внутренних электрических сетей промышленных, коммерческих и жилых объектов. Установка ВРУ, щитов, прокладка кабельных трасс, подключение технологического оборудования.',
    list: ['Монтаж ВРУ, ГРЩ, этажных щитов', 'Прокладка кабельных трасс внутри зданий', 'Подключение промышленного оборудования', 'Монтаж освещения и розеточных групп', 'Замеры: изоляция, петля фаза-ноль'],
    slides: ['ВРУ', 'Кабельные трассы', 'Щитовая'],
  },
  '5': {
    badge: 'Исполнительная документация',
    title: 'Исполнительная документация',
    desc: 'Подготовка полного комплекта ИД для сдачи объекта в эксплуатацию. Акты скрытых работ, исполнительные схемы, геодезические съёмки, протоколы испытаний — строго по требованиям надзора.',
    list: ['Акты скрытых работ (АСР)', 'Исполнительные схемы и чертежи', 'Геодезическая исполнительная съёмка', 'Протоколы испытаний и измерений', 'Журналы работ, акты приёмки'],
    slides: ['АСР', 'Исполнительные схемы', 'Протоколы'],
  },
  '6': {
    badge: 'Проектирование',
    title: 'Проектирование',
    desc: 'Разработка проектной и рабочей документации для объектов электроснабжения любой сложности. Получение ТУ, согласование с Россети / Мосэнерго, сопровождение экспертизы. Авторский надзор.',
    list: ['Разработка проектной и рабочей документации', 'Получение технических условий', 'Согласование с сетевыми организациями', 'Прохождение государственной экспертизы', 'Авторский надзор в период СМР'],
    slides: ['Однолинейная схема', 'Генплан', 'Разрез'],
  },
};

let currentSvc = null;
let currentSlide = 0;

document.querySelectorAll('.service-card-clickable').forEach((card) => {
  card.addEventListener('click', () => {
    const id = card.dataset.svc;
    document.querySelectorAll('.service-card-clickable').forEach((item) => item.classList.remove('active'));
    card.classList.add('active');

    if (currentSvc === id) {
      const det = document.getElementById('service-details');
      det.classList.remove('shown');
      setTimeout(() => det.classList.remove('visible'), 250);
      currentSvc = null;
      return;
    }
    currentSvc = id;
    currentSlide = 0;
    showServiceDetail(id);
  });
});

function showServiceDetail(id) {
  const svc = SERVICES[id];
  const det = document.getElementById('service-details');
  det.classList.remove('shown');

  setTimeout(() => {
    document.getElementById('detail-text').innerHTML = `
      <div class="detail-badge">${svc.badge}</div>
      <h3 class="detail-title">${svc.title}</h3>
      <p class="detail-desc">${svc.desc}</p>
      <ul class="detail-checklist">
        ${svc.list.map((item) => `<li>${item}</li>`).join('')}
      </ul>
      <a href="#request" class="btn btn-primary">Обсудить проект</a>
    `;

    document.getElementById('gallery-frame').innerHTML = svc.slides.map((slide, i) => `
      <div class="gallery-slide ${i === 0 ? 'active' : ''}">
        <img class="gallery-slide-img" src="/img/services/svc_${id}_${i + 1}.jpg" alt="${slide}"
          data-image-fallback="show-next">
        <div class="gallery-slide-placeholder">Фото скоро</div>
        <div class="gallery-slide-sub">${slide}</div>
      </div>
    `).join('');

    updateGalleryCounter();
    det.classList.add('visible');
    det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    requestAnimationFrame(() => det.classList.add('shown'));
  }, 200);
}

function updateGalleryCounter() {
  const svc = SERVICES[currentSvc];
  if (!svc) return;
  document.getElementById('gallery-counter').textContent = `${currentSlide + 1} / ${svc.slides.length}`;
}

document.getElementById('gallery-prev').addEventListener('click', () => {
  if (!currentSvc) return;
  const slides = document.querySelectorAll('.gallery-slide');
  slides[currentSlide].classList.remove('active');
  currentSlide = (currentSlide - 1 + slides.length) % slides.length;
  slides[currentSlide].classList.add('active');
  updateGalleryCounter();
});

document.getElementById('gallery-next').addEventListener('click', () => {
  if (!currentSvc) return;
  const slides = document.querySelectorAll('.gallery-slide');
  slides[currentSlide].classList.remove('active');
  currentSlide = (currentSlide + 1) % slides.length;
  slides[currentSlide].classList.add('active');
  updateGalleryCounter();
});

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

  const body = { message: '' };
  if (fd.get('name')) body.name = fd.get('name');
  body.phone = phoneVal;
  const btn = event.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Отправка...';

  const { ok } = await apiRequest('POST', '/api/contact', body);

  if (ok) {
    showToast('Заявка отправлена, мы свяжемся с вами!', 'success');
    event.target.reset();
  } else {
    showToast('Ошибка отправки, позвоните нам', 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Получить расчёт бесплатно';
});

const toTopBtn = document.getElementById('btn-to-top');
window.addEventListener('scroll', () => {
  toTopBtn.classList.toggle('visible', window.scrollY > 400);
}, { passive: true });
toTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
