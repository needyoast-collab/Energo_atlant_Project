# ЭнергоАтлант

Веб-платформа управления строительными проектами для электромонтажной компании. Проект включает публичный сайт и личные кабинеты для внутренних ролей, заказчиков и партнёров.

## Что есть в системе

- Публичный сайт: услуги, портфолио, партнёрская программа, контакты и форма заявки.
- Авторизация, регистрация и восстановление пароля по email/логину/телефону.
- Кабинеты ролей: администратор, менеджер, прораб, снабженец, ПТО, заказчик, партнёр.
- CRM-воронка проектов и создание проектов из заявок.
- Коммерческие предложения, ВОР, ВОМ, смета и коэффициенты проекта.
- Склад компании и склад объекта.
- Этапы работ, фотоотчёты, документы, уведомления и сообщения.
- Генерация КП из шаблона Word.

## Стек

- Frontend: HTML, CSS, Vanilla JS.
- Backend: Node.js 18+, Express 4.
- Database: PostgreSQL.
- Sessions: `express-session` + `connect-pg-simple`.
- Security: Helmet, CORS, rate-limit, Argon2id, Zod.
- Storage: S3-compatible storage, в продакшене Yandex Object Storage.
- AI: Google Gemini API.
- Documents: `docxtemplater`, `pizzip`.

## Быстрый запуск

1. Установить зависимости:

```bash
npm install
```

2. Поднять локальные сервисы:

```bash
docker compose up -d
```

3. Создать `.env` на основе `.env.example` и заполнить значения:

```bash
cp .env.example .env
```

4. Запустить сервер:

```bash
npm run dev
```

или без `nodemon`:

```bash
npm start
```

5. Открыть сайт:

```text
http://localhost:3000
```

Миграции применяются автоматически при старте сервера через `db/init.js`.

## Переменные окружения

Минимальный набор для локального запуска:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/energoatlant
SESSION_SECRET=<длинная_случайная_строка>
```

Файловое хранилище:

```env
YOS_BUCKET=energoatlant-files
YOS_ENDPOINT=https://storage.yandexcloud.net
YOS_ACCESS_KEY=
YOS_SECRET_KEY=
```

Почта и SMS:

```env
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMSRU_API_ID=
```

AI:

```env
GEMINI_API_KEY=
```

Если `SMSRU_API_ID` не задан, SMS работают в mock-режиме и код выводится в консоль. В dev-режиме код регистрации/восстановления может быть `123456`.

## Администратор

Создать стартового администратора можно скриптом:

```bash
node scripts/seed-admin.js
```

Скрипт создаёт:

```text
Email: admin@energoatlant.ru
Пароль: Admin1234!
```

После первого входа пароль нужно сменить.

## Основные страницы

Публичная часть:

- `public/index.html` — главная страница.
- `public/services.html` — услуги.
- `public/portfolio.html` — портфолио.
- `public/partners.html` — партнёрская программа.
- `public/contact.html` — контакты.
- `public/login.html` — вход.
- `public/register.html` — регистрация.

Кабинеты:

- `public/dashboard_admin.html` — администратор.
- `public/dashboard_manager.html` — менеджер.
- `public/dashboard_foreman.html` — прораб.
- `public/dashboard_supplier.html` — снабженец.
- `public/dashboard_pto.html` — ПТО.
- `public/dashboard_customer.html` — заказчик.
- `public/dashboard_partner.html` — партнёр.

## Роли

- `admin` — пользователи, справочники, проекты, метрики, выплаты.
- `manager` — заявки, проекты, команда, смета, КП, документы.
- `foreman` — этапы, фото, ВОР, согласование ВОМ, склад объекта, заявки МТР.
- `supplier` — ВОМ, обеспечение материалов, общий склад и склады объектов.
- `pto` — документы и исполнительная документация.
- `customer` — свои объекты, ход работ, документы, заявки.
- `partner` — партнёрская статистика и выплаты.

## Структура проекта

```text
config/          конфигурация БД, сессий, Helmet, S3-хранилища
controllers/     бизнес-логика API
db/              миграции и запуск миграций
middleware/      авторизация и обработка ошибок
public/          статический frontend
routes/          Express routes
scripts/         вспомогательные скрипты
templates/       шаблоны документов
utils/           общие утилиты
```

## API

Основные группы маршрутов:

- `/api/auth` — регистрация, вход, восстановление пароля, текущий пользователь.
- `/api/public` — публичные заявки.
- `/api/admin` — администрирование.
- `/api/manager` — кабинет менеджера.
- `/api/foreman` — кабинет прораба.
- `/api/supplier` — кабинет снабженца.
- `/api/pto` — кабинет ПТО.
- `/api/customer` — кабинет заказчика.
- `/api/partner` — кабинет партнёра.
- `/api/messages` — сообщения.
- `/api/notifications` — уведомления.
- `/api/documents` — выдача файлов через signed URL.

Формат ответа API:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": "Сообщение" }
```

## База данных

Используется PostgreSQL. Все миграции лежат в `db/migrations` и применяются по имени файла в алфавитном порядке.

Важные принципы:

- удаляемые сущности используют `is_deleted`;
- пароли хранятся только как Argon2id hash;
- файлы хранятся по ключу S3/Yandex Object Storage;
- API не должен возвращать `password_hash`;
- новые запросы к БД должны явно перечислять поля, без `SELECT *`.

## Локальные сервисы

`docker-compose.yml` поднимает:

- PostgreSQL на `localhost:5432`;
- MinIO на `localhost:9000`;
- MinIO Console на `localhost:9001`.

MinIO нужен как локальный S3-compatible аналог объектного хранилища. В продакшене используется Yandex Object Storage.

## Разработка

Перед изменениями смотри:

- `AGENTS.md` — правила разработки и бизнес-логика.
- `TASKS_BACKLOG.md` — текущий список задач.
- `frontend.md` — дизайн-система публичной части.

Базовые правила проекта:

- backend-логика находится в `controllers`, routes только связывают endpoint и controller;
- общую логику выносить в `utils` или middleware;
- не добавлять абстракции “на будущее”;
- изменения БД оформлять миграцией;
- после backend-изменений перезапускать сервер, если он запущен не через `nodemon`.

## Продакшен

Ожидаемая схема:

- frontend-статика обслуживается с домена `energoatlant.ru`;
- backend работает как Node.js процесс на VPS;
- PostgreSQL используется как основная БД;
- файлы хранятся в Yandex Object Storage;
- сессии хранятся в PostgreSQL.

Перед деплоем нужно проверить:

- заполнены production `.env`;
- задан сильный `SESSION_SECRET`;
- включён `NODE_ENV=production`;
- настроены SMTP/SMS при необходимости;
- настроен доступ к Yandex Object Storage;
- применены все миграции.
