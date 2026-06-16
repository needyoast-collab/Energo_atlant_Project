if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

const PROJECTS = [
  {
    id: 1, type: 'ВЛ', img: '/img/portfolio/obj_1_1.jpg',
    name: 'ВЛ-0,4 кВ "ДШТ Чайка"',
    location: 'Московская обл., Красногорск',
    voltage: '0,4 кВ',
    year: '2025',
    length: '0,6 км',
    desc: 'Строительство воздушной линии электропередачи 0,4 кВ на металлических опорах типа СФГ-700. Натяжка провода СИП-2 3×150+1×95, устройство заземлений семи опор.',
  },
  {
    id: 2, type: 'ВЛ', img: '/img/portfolio/obj_2_1.jpg',
    name: 'Освещение пешеходных переходов, ВЛ 0,4 кВ',
    location: 'Московская область, пгт Лотошино',
    voltage: '0,4 кВ',
    year: '2025',
    length: '-',
    desc: 'Монтаж и подключение освещения на четырёх пешеходных переходах в рамках программы повышения безопасности дорожного движения. Установка опор, прокладка кабеля, подключение к существующей сети.',
  },
  {
    id: 3, type: 'ТП', img: '/img/portfolio/obj_3_1.jpg',
    name: 'КТП 630 кВА',
    location: 'Московская обл.',
    voltage: '10/0.4 кВ',
    year: '2024',
    length: '—',
    desc: 'Монтаж комплектной трансформаторной подстанции 10/0.4 кВ мощностью 630 кВА для промышленного предприятия.',
  },
  {
    id: 4, type: 'КТП', img: '/img/portfolio/obj_4_1.jpg',
    name: 'КТП 400 кВА',
    location: 'Одинцово, Московская обл.',
    voltage: '10/0.4 кВ',
    year: '2024',
    length: '-',
    desc: 'Монтаж комплектной трансформаторной подстанции 10/0.4 кВ мощностью 400 кВА для жилого комплекса. Установка трансформатора, сборка и подключение КРУ, прокладка кабельных линий к распределительным щитам.',
  },
  {
    id: 5, type: 'РТП', img: '/img/portfolio/obj_5_1.jpg',
    name: 'Монтаж РТП 6 кВ с ГНБ',
    location: 'Москва',
    voltage: '6 кВ',
    year: '2025',
    length: '-',
    desc: 'Монтаж РТП 6 кВ с ГНБ для электроснабжения нового жилого комплекса. Бестраншейная прокладка кабельной линии 6 кВ протяжённостью 1 км, установка РТП в защитном кожухе, подключение к городской сети.',
  },
  {
    id: 6, type: 'КТП', img: '/img/portfolio/obj_6_1.jpg',
    name: 'КТП 630 кВА для производственного предприятия',
    location: 'Подольск, Московская обл.',
    voltage: '10/0,4 кВ',
    year: '2024',
    length: '-',
    desc: 'Монтаж комплектной трансформаторной подстанции 10/0,4 кВ мощностью 630 кВА для производственного предприятия. Включает установку трансформатора, сборку и подключение КРУ, прокладку кабельных линий к распределительным щитам.',
  },
  {
    id: 7, type: 'КЛ', img: '/img/portfolio/obj_7_1.jpg',
    name: 'КЛ 10 кВ для реконструкции подстанции',
    location: 'Серпухов, Московская обл.',
    voltage: '10 кВ',
    year: '2024',
    length: '0,8 км',
    desc: 'Прокладка кабельной линии 10 кВ протяженностью 800 м. Кабель ААБ2л-10кВ 1×240 мм², монтаж концевых муфт, испытания повышенным напряжением. Линия обеспечивает электроснабжение реконструируемой подстанции и подключение новых потребителей.',
  },
  {
    id: 8, type: 'ВЛ', img: '/img/portfolio/obj_8_1.jpg',
    name: 'ВЛ-0,4 кВ СНТ "Калинка"',
    location: 'Можайск, Московская обл.',
    voltage: '0,4 кВ',
    year: '2024',
    length: '1,4 км',
    desc: 'Монтаж ВЛ-0,4кВ для СНТ "Калинка".',
  },
  {
    id: 9, type: 'ТП', img: '/img/portfolio/obj_9_1.jpg',
    name: 'Трансформаторы СНТ "Одиночка"',
    location: 'Московская обл.',
    voltage: '10, 0,4 кВ',
    year: '2025',
    length: '2 шт.',
    desc: 'Монтаж трансформаторов для СНТ "Одиночка".',
  },
  {
    id: 10, type: 'ВЛ', img: '/img/portfolio/obj_10_1.jpg',
    name: 'Монтаж ВЛ-0,4 кВ для РЖД',
    location: 'Московская обл.',
    voltage: '0,4 кВ',
    year: '2023',
    length: '1 км.',
    desc: 'Монтаж ВЛ-0,4 кВ для РЖД.',
  },
  {
    id: 11, type: 'ТП', img: '/img/portfolio/obj_11_1.jpg',
    name: 'Установка трансформатора и разъединителя',
    location: 'Московская обл.',
    voltage: '10, 0,4 кВ',
    year: '2023',
    length: '1 шт',
    desc: 'Установка трансформатора и разъединителя для электроснабжения нового жилого комплекса.',
  },
  {
    id: 12, type: 'ТП', img: '/img/portfolio/obj_12_1.jpg',
    name: 'Замена фундамента ЗРУ 35 кВ',
    location: 'Московская обл.',
    voltage: '35 кВ',
    year: '2022',
    length: '1 шт.',
    desc: 'Замена фундамента ЗРУ 35 кВ.',
  },
];

let activeFilter = 'all';

function renderCards() {
  const grid = document.getElementById('portfolio-grid');
  const filtered = activeFilter === 'all' ? PROJECTS : PROJECTS.filter((project) => project.type === activeFilter);

  grid.innerHTML = filtered.map((project, i) => `
    <div class="portfolio-card" data-id="${project.id}" data-aos="fade-up" data-aos-delay="${(i % 3) * 60}">
      <div class="portfolio-photo">
        <img class="portfolio-card-img" src="${safeAttrUrl(project.img)}" alt="${escAttr(project.name)}"
          data-image-fallback="show-next">
        <div class="portfolio-photo-placeholder-inline">Фото скоро</div>
        <div class="portfolio-photo-type">${escHtml(project.type)}</div>
      </div>
      <div class="portfolio-info">
        <div class="portfolio-name">${escHtml(project.name)}</div>
        <div class="portfolio-meta">
          <span>📍 <strong>${escHtml(project.location)}</strong></span>
          <span>${escHtml(project.voltage)}</span>
          <span>${escHtml(project.year)}</span>
        </div>
      </div>
    </div>
  `).join('') || '<div class="portfolio-empty-state">Нет объектов по выбранному фильтру</div>';

  if (window.AOS) AOS.refresh();
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((item) => item.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderCards();
  });
});

let galleryPhotos = [];
let galleryIndex = 0;

function goGallery(index) {
  const slider = document.getElementById('proj-gallery');
  if (!slider) return;
  galleryIndex = (index + galleryPhotos.length) % galleryPhotos.length;
  slider.querySelectorAll('.gallery-slide').forEach((slide, i) => slide.classList.toggle('active', i === galleryIndex));
  slider.querySelectorAll('.gallery-dot').forEach((dot, i) => dot.classList.toggle('active', i === galleryIndex));
  const counter = slider.querySelector('.gallery-counter');
  if (counter) counter.textContent = (galleryIndex + 1) + ' / ' + galleryPhotos.length;
}

function detectPhotos(id) {
  const results = [];
  const tasks = [];
  for (let i = 1; i <= 20; i += 1) {
    const url = '/img/portfolio/obj_' + id + '_' + i + '.jpg';
    const n = i;
    tasks.push(new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { results.push({ n, url }); resolve(); };
      img.onerror = () => resolve();
      img.src = url;
    }));
  }
  return Promise.all(tasks).then(() => results.sort((a, b) => a.n - b.n).map((row) => row.url));
}

function buildGallery(photos, name) {
  galleryPhotos = photos;
  galleryIndex = 0;
  if (!photos.length) return '<div class="modal-photo-placeholder"><span class="ph-label">⚡</span></div>';
  const nav = photos.length > 1;
  const slides = photos.map((url, i) =>
    '<div class="gallery-slide' + (i === 0 ? ' active' : '') + '"><img src="' + safeAttrUrl(url) + '" alt="' + escAttr(name) + '"></div>'
  ).join('');
  const dots = nav ? photos.map((_, i) =>
    '<div class="gallery-dot' + (i === 0 ? ' active' : '') + '" data-gi="' + i + '"></div>'
  ).join('') : '';
  return '<div class="gallery-slider" id="proj-gallery">' +
    slides +
    (nav ? '<button class="gallery-btn gallery-prev" data-gd="-1">&#8249;</button>' : '') +
    (nav ? '<button class="gallery-btn gallery-next" data-gd="1">&#8250;</button>' : '') +
    (nav ? '<div class="gallery-counter">1 / ' + photos.length + '</div>' : '') +
    (nav ? '<div class="gallery-dots">' + dots + '</div>' : '') +
  '</div>';
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-gd]');
  if (btn) {
    event.stopPropagation();
    goGallery(galleryIndex + parseInt(btn.dataset.gd, 10));
    return;
  }
  const dot = event.target.closest('[data-gi]');
  if (dot && dot.classList.contains('gallery-dot')) {
    event.stopPropagation();
    goGallery(parseInt(dot.dataset.gi, 10));
  }
});

document.getElementById('portfolio-grid').addEventListener('click', async (event) => {
  const card = event.target.closest('.portfolio-card');
  if (!card) return;
  const project = PROJECTS.find((item) => item.id == card.dataset.id);
  if (!project) return;

  document.getElementById('modal-project-content').innerHTML =
    '<div class="gallery-slider portfolio-gallery-loading">Загружаем фото...</div>' +
    '<div class="modal-title modal-title-spaced">' + escHtml(project.name) + '</div>';
  document.getElementById('modal-project').classList.add('open');

  const photos = await detectPhotos(project.id);
  const lenRow = project.length !== '—'
    ? '<div class="modal-detail-item"><label>Протяжённость</label><span>' + escHtml(project.length) + '</span></div>'
    : '';

  document.getElementById('modal-project-content').innerHTML =
    buildGallery(photos, project.name) +
    '<div class="modal-project-tags">' +
      '<span class="tag">' + escHtml(project.type) + '</span>' +
      '<span class="tag">' + escHtml(project.voltage) + '</span>' +
      '<span class="tag">' + escHtml(project.year) + '</span>' +
    '</div>' +
    '<div class="modal-title">' + escHtml(project.name) + '</div>' +
    '<div class="modal-detail-grid">' +
      '<div class="modal-detail-item"><label>Местоположение</label><span>' + escHtml(project.location) + '</span></div>' +
      '<div class="modal-detail-item"><label>Класс напряжения</label><span>' + escHtml(project.voltage) + '</span></div>' +
      '<div class="modal-detail-item"><label>Год завершения</label><span>' + escHtml(project.year) + '</span></div>' +
      lenRow +
    '</div>' +
    '<p class="modal-project-desc">' + escHtml(project.desc) + '</p>' +
    '<a href="/contact.html#request" class="btn btn-primary">Обсудить похожий проект</a>';
});

document.getElementById('modal-project-close').addEventListener('click', () => {
  document.getElementById('modal-project').classList.remove('open');
});

document.getElementById('modal-project').addEventListener('click', (event) => {
  if (event.target === document.getElementById('modal-project')) {
    document.getElementById('modal-project').classList.remove('open');
  }
});

renderCards();
