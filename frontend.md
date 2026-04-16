# frontend.md — ЭнергоАтлант

Инструкция по фронтенду для Claude Code.
Читать вместе с CLAUDE.md.

---

## UI-фишки (обязательно реализовать)

### Бегущая строка (marquee)
CSS анимация, без JS библиотек. Два одинаковых блока подряд — при смещении на 50% выглядит бесконечно.
```css
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.marquee-track { display: flex; animation: marquee 15s linear infinite; white-space: nowrap; }
```

### Прелоадер с пульсацией логотипа
Логотип (`/img/logo.svg`) пульсирует + янтарное свечение через drop-shadow:
```css
@keyframes pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 0px var(--accent)); opacity: 1; transform: scale(1); }
  50%       { filter: drop-shadow(0 0 20px var(--accent)); opacity: 0.8; transform: scale(0.97); }
}
.preloader-logo { animation: pulse-glow 1.5s ease-in-out infinite; }
```

### Карточки услуг — интерактивный детальный блок
Клик на карточку → плавный скролл к секции `#details` + смена контента (fade анимация).
Активная карточка: `border-left: 3px solid var(--accent); background: var(--dark3)`.

### Фото проектов — grayscale → цвет
```css
.project-photo img { filter: grayscale(100%); transition: filter 0.4s ease, transform 0.4s ease; }
.project-photo:hover img { filter: grayscale(0%); transform: scale(1.05); }
```

### Партнёры — fade по краям
```css
.partners-wrap::before, .partners-wrap::after {
  content: ''; position: absolute; top: 0; width: 80px; height: 100%; z-index: 1;
}
.partners-wrap::before { left: 0; background: linear-gradient(to right, var(--dark2), transparent); }
.partners-wrap::after  { right: 0; background: linear-gradient(to left, var(--dark2), transparent); }
```

### Кнопка "Наверх"
Появляется при `window.scrollY > 400`, плавный fade через CSS класс.

### Плавное появление блоков (AOS)
Каждый смысловой блок, карточка, заголовок — `data-aos="fade-up"`.
Карточки в сетке — с нарастающим `data-aos-delay`: 0, 100, 200ms.

---

## Технологии

- Vanilla JS (ES6+)
- Tailwind CSS
- AOS (Animate On Scroll) — плавное появление элементов
- Google Fonts (Bebas Neue + Manrope)

---

## Дизайн-система

### Цвета

> Акцентный цвет уточняется — см. финальное решение с заказчиком.
> Переменные вынесены в CSS, менять только в одном месте.

```css
:root {
  --color-bg:        #060A10;   /* основной фон */
  --color-bg2:       #0C1420;   /* вторичный фон (карточки, секции) */
  --color-bg3:       #111D2E;   /* третичный фон */
  --color-accent:    #00CFFF;   /* акцент — уточняется */
  --color-text:      #E8F0F8;   /* основной текст */
  --color-muted:     #7A90A8;   /* второстепенный текст */
}
```

### Шрифты

```css
/* Заголовки */
font-family: 'Bebas Neue', sans-serif;

/* Текст, кнопки, навигация */
font-family: 'Manrope', sans-serif;
```

### Кнопки

Все кнопки — с закруглёнными углами (`border-radius: 9999px` — pill).

```css
/* Основная кнопка */
.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg);
  padding: 14px 32px;
  border-radius: 9999px;
  font-family: 'Manrope', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

/* Контурная кнопка */
.btn-ghost {
  background: transparent;
  color: var(--color-text);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 9999px;
  padding: 14px 32px;
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-ghost:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
```

### Анимации появления (AOS)

Каждый блок, карточка, заголовок на странице появляется плавно при скролле.
Использовать атрибуты AOS на элементах:

```html
<!-- Снизу вверх -->
<div data-aos="fade-up" data-aos-duration="600">...</div>

<!-- Слева -->
<div data-aos="fade-right" data-aos-duration="600" data-aos-delay="100">...</div>

<!-- Справа -->
<div data-aos="fade-left" data-aos-duration="600" data-aos-delay="200">...</div>

<!-- Карточки в сетке — с задержкой по порядку -->
<div data-aos="fade-up" data-aos-delay="0">...</div>
<div data-aos="fade-up" data-aos-delay="100">...</div>
<div data-aos="fade-up" data-aos-delay="200">...</div>
```

Инициализация в каждом JS файле:
```javascript
AOS.init({ once: true, offset: 60 });
```

### Фото в оттенках серого

Все фотографии (портфолио, объекты) по умолчанию серые. При наведении — цветные.

```css
.photo-item img {
  filter: grayscale(100%);
  transition: filter 0.4s ease;
}
.photo-item:hover img {
  filter: grayscale(0%);
}
```

### Адаптивность

Все страницы адаптированы под:
- Мобильные: 320px–767px
- Планшеты: 768px–1023px
- Десктоп: 1024px+

Использовать Tailwind breakpoints: `sm:`, `md:`, `lg:`, `xl:`.
Мобильная версия — приоритет (mobile-first).

---

## Прелоадер

На каждой странице сайта и дашбордах.

**Поведение:**
- Фон `var(--color-bg)`, по центру логотип компании (файл `img/logo.svg`)
- Логотип пульсирует (`pulse` анимация) пока страница грузится
- После загрузки: fade out 400ms, затем `display: none`

**Реализация:** `js/preloader.js` — подключается на всех страницах.

```html
<!-- Разметка прелоадера (вставить первым в body) -->
<div id="preloader">
  <img src="/img/logo.svg" alt="ЭнергоАтлант" class="preloader-logo">
</div>
```

```css
#preloader {
  position: fixed;
  inset: 0;
  background: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.4s ease;
}
#preloader.hidden {
  opacity: 0;
  pointer-events: none;
}
.preloader-logo {
  width: 160px;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.96); }
}
```

```javascript
// js/preloader.js
window.addEventListener('load', () => {
  const preloader = document.getElementById('preloader');
  preloader.classList.add('hidden');
  setTimeout(() => preloader.style.display = 'none', 400);
});
```

---

## Плавающая кнопка звонка

На всех страницах — правый нижний угол.

```html
<a href="tel:+79939074577" class="float-call" aria-label="Позвонить">
  <!-- иконка телефона SVG -->
</a>
```

```css
.float-call {
  position: fixed;
  bottom: 32px;
  right: 32px;
  width: 56px;
  height: 56px;
  background: var(--color-accent);
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  transition: transform 0.2s;
}
.float-call:hover {
  transform: scale(1.1);
}
```

---

## Навбар (общий для всех страниц)

```
Лого | Главная · Наши объекты · Услуги · Партнёрам · Контакты | [Личный кабинет]
```

- Фиксированный (`position: fixed`), фон с лёгким blur на скролле
- Кнопка "Личный кабинет" — справа, pill-стиль, ведёт на `/login.html`
- На мобильном — гамбургер-меню

---

## Страницы

### index.html — Главная

Секции сверху вниз:

**1. Герой (первый экран)**
- Видео справа (опора ВЛ 110 кВ, беспилотник), текст слева — layout как в АТЕРЭНЕРГО
- Крупный заголовок простыми словами ("Строим электрические сети под ключ")
- Подзаголовок — 1-2 предложения без терминов
- Две кнопки: "Получить расчёт бесплатно" (якорь на форму) и "Смотреть объекты" (ссылка на портфолио)
- Под кнопками — 3 цифры: объектов сдано / лет опыта / гарантия

**2. Бегущая строка (marquee)**
- Янтарный фон, тёмный текст: "ПРОЕКТИРОВАНИЕ · СМР · ГНБ · СОГЛАСОВАНИЕ · ПНР · КАБЕЛЬНЫЕ ЛИНИИ"
- Бесконечная прокрутка влево, CSS анимация
- Разделитель между героем и следующей секцией

**3. Услуги (карточки)**
- 6 карточек в сетке 3×2
- Каждая: иконка + название + 1 предложение простыми словами
- При клике на карточку — плавный скролл к детальному блоку ниже
- Активная карточка подсвечивается янтарным border-left

**4. Детальный блок услуги**
- Раскрывается при клике на карточку выше
- Слева: badge с подзаголовком, заголовок, описание, чек-лист, кнопка CTA
- Справа: фото с галереей (стрелки влево/вправо, счётчик фото)
- Свайп на мобильных
- Анимация смены услуги (fade + slide)

**5. Как мы работаем (этапы)**
- 4 шага с иконками: Заявка → Выезд → Монтаж → Сдача
- Каждый шаг — иконка в квадрате янтарного цвета, заголовок, описание
- border-top янтарный на каждой карточке

**6. Мокап личного кабинета**
- Слева: заголовок "Контролируйте ход работ онлайн", описание, чек-лист, кнопка "Войти в кабинет"
- Справа: карточка-мокап дашборда — название объекта, прогресс-бар, счётчики фото и актов
- Показывает продукт прямо на главной

**7. Партнёры / "Нам доверяют"**
- Бегущая строка с названиями партнёров
- Градиентное размытие по краям (fade mask)
- Тёмный фон, приглушённый текст → янтарный при наведении

**8. Контакты + форма (3 колонки)**
- Слева: заголовок "Есть объект? Обсудим!", телефон, Telegram, адрес
- По центру: логотип с пульсирующим свечением янтарного цвета
- Справа: форма на светлом фоне — Имя, Телефон, кнопка "Получить расчёт бесплатно"
- Чекбокс согласия с политикой конфиденциальности
- После отправки — анимация успеха поверх формы

**9. Футер**
- Логотип, ссылки на страницы, телефон, email
- Ссылка на политику конфиденциальности
- Кнопка "Наверх" — появляется при скролле > 400px, фиксированная позиция

---

### portfolio.html — Наши объекты

- Фильтры по типу работ: Все / КЛ / ВЛ / ТП / ГНБ
- Сетка карточек объектов
- Карточка: фото (серое → цветное при наведении), название объекта, тип работ, класс напряжения
- При клике — модальное окно с деталями и галереей фото

---

### services.html — Услуги

Каждая услуга — отдельная секция с описанием простыми словами:

1. **Проектирование** — разрабатываем проект электроснабжения объекта
2. **СМР** (строительно-монтажные работы) — прокладка кабелей, монтаж оборудования
3. **ГНБ** (горизонтально-направленное бурение) — прокладка кабеля под дорогами и реками без вскрытия
4. **Согласование проектов** — получаем все необходимые разрешения
5. **ПНР** (пуско-наладочные работы) — запускаем и проверяем установленное оборудование

> Решение о "внутрянке" (внутренние электросети) — уточнить у заказчика.

Внизу каждой секции — кнопка "Обсудить проект" → якорь на форму заявки.

---

### partners.html — Партнёрам

**Структура страницы:**

1. Заголовок + короткое описание программы простыми словами
2. Как это работает — 3 шага: регистрируешься → приводишь клиента → получаешь комиссию
3. Уровни партнёрства:

| Уровень | Условие | Комиссия |
|---------|---------|---------|
| Старт   | 0-2 клиента | 5% |
| Базовый | 3-7 клиентов | 8% |
| Профи   | 8-15 клиентов | 12% |
| Эксперт | 15+ клиентов | 15% |

4. Кто может стать партнёром — проектировщики, подрядчики, риелторы, все
5. CTA — кнопка "Стать партнёром" → /register.html

---

### contact.html — Контакты

- Адрес, телефон, email
- Форма обратной связи (имя, телефон, сообщение)
- Карта (Яндекс.Карты embed)

---

### login.html — Вход

- Форма: email + пароль
- Кнопка "Войти"
- Ссылка "Нет аккаунта? Зарегистрироваться" → /register.html
- POST /api/auth/login → редирект на нужный дашборд по роли

---

### register.html — Регистрация

- Только для заказчиков (остальные роли создаёт админ)
- Поля: имя, email, телефон, пароль, подтверждение пароля
- Чекбокс согласия с политикой конфиденциальности
- POST /api/auth/register → сообщение "Ожидайте подтверждения"

---

### 404.html — Страница не найдена

- В стиле сайта
- Короткое сообщение и кнопка "На главную"

---

### privacy.html — Политика конфиденциальности

- Стандартный текст
- Нужна для формы заявки (152-ФЗ)

---

## Favicon

Использовать логотип компании (`img/logo.svg`) как favicon.

```html
<link rel="icon" type="image/svg+xml" href="/img/logo.svg">
```

---

## OG-теги (превью в мессенджерах)

На каждой странице:

```html
<meta property="og:title" content="ЭнергоАтлант — электромонтажные работы 0.4–110 кВ">
<meta property="og:description" content="Строим кабельные линии и подстанции под ключ в Москве и области">
<meta property="og:image" content="https://energoatlant.ru/img/og-preview.jpg">
<meta property="og:url" content="https://energoatlant.ru">
<meta property="og:type" content="website">
```

---

## Структура JS файлов

```
public/js/
├── preloader.js    # прелоадер — на всех страницах
├── api.js          # apiRequest(), showToast() — на всех страницах
├── nav.js          # навбар, мобильное меню — на всех страницах
├── float-call.js   # плавающая кнопка звонка — на всех страницах
├── auth.js         # login.html, register.html
├── index.js        # index.html
├── portfolio.js    # portfolio.html
├── services.js     # services.html
├── partners.js     # partners.html
├── contact.js      # contact.html
├── admin.js        # dashboard_admin.html
├── manager.js      # dashboard_manager.html
├── foreman.js      # dashboard_foreman.html
├── supplier.js     # dashboard_supplier.html
├── pto.js          # dashboard_pto.html
├── customer.js     # dashboard_customer.html
└── partner.js      # dashboard_partner.html
```

---

_Последнее обновление: апрель 2026_
