# CLAUDE.md — ЭнергоАтлант

Этот файл — инструкция для Claude Code при работе в репозитории.
Читай его полностью перед тем как писать любой код.

---

## Проект

**ЭнергоАтлант** — веб-платформа управления строительными проектами
для электромонтажной компании. Включает публичный сайт (лендинг) и
личные кабинеты для 7 ролей пользователей.

- Домен: energoatlant.ru
- Хостинг фронта: REG.RU (статика)
- Хостинг бэка: VPS (Node.js процесс)

---

## Принципы написания кода

Это не рекомендации — это правила. Каждый коммит должен им соответствовать.

### KISS — Keep It Simple, Stupid
Простое решение лучше умного. Если можно сделать проще — делай проще.

### DRY — Don't Repeat Yourself
Общая логика выносится в утилиты, middleware или хелперы. Один код — одно место.

### YAGNI — You Aren't Gonna Need It
Реализуй только то, что нужно прямо сейчас. Никаких абстракций впрок.

### SOLID
- S — каждый модуль/функция делает одно дело
- O — открыт для расширения, закрыт для изменения
- L — подтипы заменяют базовые типы без сюрпризов
- I — интерфейсы узкие, не монолитные
- D — зависимости через инъекцию, не хардкод

### Бритва Оккама
Минимум сущностей для решения задачи. Не умножай абстракции без причины.

### APO — Avoid Premature Optimization
Сначала правильно, потом быстро — если будет измеренная проблема.

### BDUF (адаптированный)
Проектируй архитектуру и схему БД до кода. Но не проектируй то, что не нужно сейчас.

---

## Стек

| Слой        | Технология                                      |
|-------------|------------------------------------------------|
| Фронтенд    | Vanilla JS (ES6+), Tailwind CSS                |
| Бэкенд      | Node.js 18+, Express 4                         |
| База данных | PostgreSQL (на VPS), connect-pg-simple         |
| Хранилище   | Yandex Object Storage (S3-совместимый)         |
| Безопасность| Argon2id, Zod, Helmet, express-rate-limit, CORS|
| AI          | Google Gemini API                              |
| Сессии      | express-session + connect-pg-simple            |

---

## Структура проекта

```
energoatlant/
├── CLAUDE.md
├── .env.example
├── .gitignore
├── package.json
├── server.js                  # Точка входа, инициализация Express
│
├── config/
│   ├── database.js            # Пул подключений PostgreSQL
│   ├── session.js             # Конфигурация сессий
│   ├── storage.js             # Yandex Object Storage (S3 клиент)
│   └── helmet.js              # Настройки безопасности HTTP
│
├── middleware/
│   ├── auth.js                # isAuthenticated, requireRole(role)
│   └── errorHandler.js        # Централизованный обработчик ошибок
│
├── routes/
│   ├── auth.js
│   ├── admin.js
│   ├── manager.js
│   ├── foreman.js
│   ├── supplier.js
│   ├── pto.js
│   ├── customer.js
│   ├── partner.js
│   ├── project.js
│   ├── messages.js
│   ├── notifications.js
│   ├── documents.js
│   └── public.js
│
├── controllers/
│   ├── authController.js
│   ├── adminController.js
│   ├── managerController.js
│   ├── foremanController.js
│   ├── supplierController.js
│   ├── ptoController.js
│   ├── customerController.js
│   ├── partnerController.js
│   ├── projectController.js
│   ├── messageController.js
│   ├── notificationController.js
│   ├── documentController.js
│   └── publicController.js
│
├── utils/
│   ├── projectCode.js         # generateProjectCode() → PRJ-2026-XXXX
│   ├── notifications.js       # sendNotification()
│   ├── signedUrl.js           # getSignedUrl() для YOS, TTL 1 час
│   └── validate.js            # Zod-схемы валидации
│
├── db/
│   ├── init.js                # Запускает миграции по порядку при старте
│   └── migrations/
│       └── 001_init.sql       # Создание всех таблиц
│
└── public/
    ├── index.html
    ├── login.html
    ├── register.html
    ├── services.html
    ├── portfolio.html
    ├── partners.html
    ├── contact.html
    ├── dashboard_admin.html
    ├── dashboard_manager.html
    ├── dashboard_foreman.html
    ├── dashboard_supplier.html
    ├── dashboard_pto.html
    ├── dashboard_customer.html
    ├── dashboard_partner.html
    ├── css/
    │   └── style.css
    └── js/
        ├── api.js             # apiRequest(), showToast()
        ├── auth.js
        ├── admin.js
        ├── manager.js
        ├── foreman.js
        ├── supplier.js
        ├── pto.js
        ├── customer.js
        └── partner.js
```

---

## Роли пользователей

Определены в `middleware/auth.js` как объект `ROLES`.
`requireRole()` принимает одну роль или массив ролей.

| Роль      | Константа        |
|-----------|-----------------|
| admin     | `ROLES.ADMIN`   |
| manager   | `ROLES.MANAGER` |
| foreman   | `ROLES.FOREMAN` |
| supplier  | `ROLES.SUPPLIER`|
| pto       | `ROLES.PTO`     |
| customer  | `ROLES.CUSTOMER`|
| partner   | `ROLES.PARTNER` |

---

## Схема базы данных

### Правила БД
- Все таблицы: `id SERIAL PRIMARY KEY`, `created_at TIMESTAMPTZ DEFAULT NOW()`
- Удаляемые сущности: `is_deleted BOOLEAN DEFAULT FALSE` (soft delete)
- Файлы хранятся по ключу YOS (`file_key`), не по локальному пути
- Никогда не использовать `SELECT *`

### users
```sql
id              SERIAL PRIMARY KEY
role            VARCHAR(20) NOT NULL        -- admin|manager|foreman|supplier|pto|customer|partner
name            VARCHAR(100) NOT NULL
email           VARCHAR(100) UNIQUE NOT NULL
password_hash   TEXT NOT NULL
is_verified     BOOLEAN DEFAULT FALSE       -- верификация админом
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### projects
```sql
id                  SERIAL PRIMARY KEY
code                VARCHAR(20) UNIQUE NOT NULL  -- PRJ-2026-XXXX
name                VARCHAR(200) NOT NULL
status              VARCHAR(30) DEFAULT 'lead'   -- воронка CRM
description         TEXT
address             VARCHAR(300)
object_type         VARCHAR(50)     -- промышленный|жилой|инфраструктурный|прочее
voltage_class       VARCHAR(50)     -- 0.4|6|10|35|110 кВ
work_types          TEXT            -- JSON массив: [КЛ, ВЛ, ТП]
contract_value      NUMERIC(15,2)
kp_sent_at          DATE            -- дата отправки КП
visit_scheduled_at  DATE            -- дата выезда на объект
planned_start       DATE
planned_end         DATE
lead_source         VARCHAR(50)     -- сайт|звонок|партнёр|тендер|повторный
partner_id          INTEGER REFERENCES users(id)
contact_name        VARCHAR(100)    -- контактное лицо заказчика
contact_phone       VARCHAR(20)
contact_email       VARCHAR(100)
contact_org         VARCHAR(200)
notes               TEXT
manager_id          INTEGER REFERENCES users(id)
is_deleted          BOOLEAN DEFAULT FALSE
created_at          TIMESTAMPTZ DEFAULT NOW()
```

#### Логика контактных данных при создании проекта
- Заказчик из ЛК - contact_name/phone/email подтягиваются из users автоматически
- Анонимная заявка с сайта - поля пустые, менеджер заполняет после звонка
- Менеджер создаёт вручную - поля пустые, заполняет сам

### project_members
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
user_id         INTEGER REFERENCES users(id)
role            VARCHAR(20) NOT NULL
joined_at       TIMESTAMPTZ DEFAULT NOW()
UNIQUE(project_id, user_id)
```

### public_requests
```sql
id              SERIAL PRIMARY KEY
name            VARCHAR(100)
phone           VARCHAR(20)
email           VARCHAR(100)
message         TEXT
status          VARCHAR(20) DEFAULT 'new'   -- new|in_progress|done|rejected
assigned_to     INTEGER REFERENCES users(id)
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### project_stages
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
name            VARCHAR(200) NOT NULL
status          VARCHAR(20) DEFAULT 'pending' -- pending|in_progress|done
order_num       INTEGER DEFAULT 0
planned_start   DATE
planned_end     DATE
actual_end      DATE
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### stage_photos
```sql
id              SERIAL PRIMARY KEY
stage_id        INTEGER REFERENCES project_stages(id)
uploaded_by     INTEGER REFERENCES users(id)
file_key        TEXT NOT NULL
description     TEXT
uploaded_at     TIMESTAMPTZ DEFAULT NOW()
```

### material_requests
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
stage_id        INTEGER REFERENCES project_stages(id)
foreman_id      INTEGER REFERENCES users(id)
supplier_id     INTEGER REFERENCES users(id)
material_name   VARCHAR(200) NOT NULL
quantity        NUMERIC(12,3) NOT NULL
unit            VARCHAR(20)
status          VARCHAR(20) DEFAULT 'pending' -- pending|approved|rejected|ordered|delivered
notes           TEXT
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### warehouse_general (общий склад компании)
```sql
id              SERIAL PRIMARY KEY
material_name   VARCHAR(200) NOT NULL
unit            VARCHAR(20)
qty_total       NUMERIC(12,3) DEFAULT 0   -- общее количество на складе
qty_reserved    NUMERIC(12,3) DEFAULT 0   -- зарезервировано под проекты
notes           TEXT
updated_at      TIMESTAMPTZ DEFAULT NOW()
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### warehouse_project (склад объекта — заменяет warehouse_items)
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
material_name   VARCHAR(200) NOT NULL
unit            VARCHAR(20)
qty_total       NUMERIC(12,3) DEFAULT 0   -- всего поступило на склад объекта
qty_used        NUMERIC(12,3) DEFAULT 0   -- списано на этапы
source          VARCHAR(20) DEFAULT 'purchase' -- company|purchase|customer
general_item_id INTEGER REFERENCES warehouse_general(id) -- если source=company
notes           TEXT
updated_at      TIMESTAMPTZ DEFAULT NOW()
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### material_specs (ведомость материалов по проекту)
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
supplier_id     INTEGER REFERENCES users(id)   -- кто составил
material_name   VARCHAR(200) NOT NULL
unit            VARCHAR(20)
quantity        NUMERIC(12,3) NOT NULL
status          VARCHAR(20) DEFAULT 'draft'    -- draft|pending_approval|approved|rejected
rejection_note  TEXT                           -- пояснение при отклонении
approved_by     INTEGER REFERENCES users(id)   -- прораб который согласовал
approved_at     TIMESTAMPTZ
is_deleted      BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### project_documents
```sql
id              SERIAL PRIMARY KEY
project_id      INTEGER REFERENCES projects(id)
uploaded_by     INTEGER REFERENCES users(id)
doc_type        VARCHAR(50)                -- тип ИД из списка ниже
file_key        TEXT NOT NULL
file_name       VARCHAR(200) NOT NULL
description     TEXT
uploaded_at     TIMESTAMPTZ DEFAULT NOW()
```

### messages
```sql
id              SERIAL PRIMARY KEY
sender_id       INTEGER REFERENCES users(id)
receiver_id     INTEGER REFERENCES users(id)
project_id      INTEGER REFERENCES projects(id)
subject         VARCHAR(200)
body            TEXT NOT NULL
is_read         BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### notifications
```sql
id              SERIAL PRIMARY KEY
user_id         INTEGER REFERENCES users(id)
project_id      INTEGER REFERENCES projects(id)
type            VARCHAR(30) NOT NULL       -- photo|document|status|message|mtr
message         TEXT NOT NULL
is_read         BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### partner_refs
```sql
id              SERIAL PRIMARY KEY
partner_id      INTEGER REFERENCES users(id)
referred_user_id INTEGER REFERENCES users(id)
status          VARCHAR(20) DEFAULT 'pending' -- pending|paid
commission      NUMERIC(10,2) DEFAULT 0
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### partner_payouts
```sql
id              SERIAL PRIMARY KEY
partner_id      INTEGER REFERENCES users(id)
amount          NUMERIC(10,2) NOT NULL
payment_details TEXT NOT NULL
status          VARCHAR(20) DEFAULT 'pending' -- pending|processing|paid|rejected
processed_at    TIMESTAMPTZ
created_at      TIMESTAMPTZ DEFAULT NOW()
```

---

## Бизнес-логика склада

### Два уровня склада
- **Общий склад компании** (`warehouse_general`) — инвентарь ЭнергоАтлант, не привязан к проектам
- **Склад объекта** (`warehouse_project`) — материалы конкретного проекта

### Процесс комплектации объекта

1. Снабженец заходит в проект → составляет **Ведомость материалов** (`material_specs`) — список что нужно с количествами
2. Прораб получает уведомление → **согласовывает** (status: approved) или **отклоняет** с пояснением (status: rejected)
3. После согласования снабженец комплектует объект — три источника:
   - **С общего склада** (source: company) → qty уменьшается на `warehouse_general`, появляется на `warehouse_project`
   - **Прямая закупка** (source: purchase) → появляется на `warehouse_project`
   - **От заказчика** (source: customer) → появляется на `warehouse_project` с пометкой
4. Прораб в процессе работ делает **заявку на материал** только если чего-то не хватает сверх ведомости
5. Снабженец обрабатывает заявку → докупает или списывает с общего склада
6. Прораб **списывает материал** со склада объекта на конкретный этап

### Статусы ведомости материалов
```
draft → pending_approval → approved
                        → rejected (с пояснением, возврат на доработку)
```

### Видимость склада
- Снабженец: видит общий склад компании + склад всех своих объектов
- Прораб: видит только склад своего объекта (остатки)
- Заказчик: видит склад своего объекта — название, ед., получено, использовано, остаток
- Менеджер/Админ: видят всё

### Права на документы проекта
**Технические документы** (rd, tu, pd, tz, construction_permit, arbp, exec_scheme, hidden_works_act, geodetic_survey, general_works_log, author_supervision, interim_acceptance, cable_test_act, measurement_protocol, other):
- Видят: все роли включая заказчика

**Финансовые документы** (kp, estimate, contract, additional_agreement, ks2, ks3):
- Видят: только менеджер, админ, заказчик
- Скрыты от: прораба, ПТО, снабженца

---

## Воронка проектов (CRM)

```
lead → qualification → visit → offer → negotiation → contract → work → won
                                                                      → lost
```

---

## Типы исполнительной документации (doc_type)

```
hidden_works_act     — Акт скрытых работ
exec_scheme          — Исполнительная схема
geodetic_survey      — Геодезическая исполнительная съёмка
general_works_log    — Общий журнал работ
author_supervision   — Журнал авторского надзора
interim_acceptance   — Акт промежуточной приёмки
cable_test_act       — Акт испытания кабельной линии
measurement_protocol — Протокол измерений
other                — Прочее
```

---

## Карта API

### /api/auth
```
POST   /api/auth/register
POST   /api/auth/login             rate limit 5/15мин
POST   /api/auth/logout
GET    /api/auth/me
```

### /api/public
```
POST   /api/public/requests        анонимная заявка с лендинга
```

### /api/admin
```
GET    /api/admin/users
POST   /api/admin/users
PUT    /api/admin/users/:id
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/verify
POST   /api/admin/users/:id/restore
GET    /api/admin/metrics
GET    /api/admin/partner-payouts
PUT    /api/admin/partner-payouts/:id
```

### /api/manager
```
GET    /api/manager/requests
PUT    /api/manager/requests/:id
GET    /api/manager/projects
POST   /api/manager/projects
PUT    /api/manager/projects/:id
POST   /api/manager/projects/:id/team
POST   /api/manager/projects/:id/analyze
GET    /api/manager/staff
```

### /api/foreman
```
POST   /api/foreman/projects/join
GET    /api/foreman/projects/:id
GET    /api/foreman/projects/:id/stages
POST   /api/foreman/projects/:id/stages
PUT    /api/foreman/stages/:id
POST   /api/foreman/stages/:id/photos

-- Склад объекта (только просмотр + списание)
GET    /api/foreman/projects/:id/warehouse         склад объекта
POST   /api/foreman/warehouse/:id/writeoff         списать материал на этап

-- Ведомость материалов (согласование)
GET    /api/foreman/projects/:id/specs             просмотр ведомости
PUT    /api/foreman/specs/:id/approve              согласовать позицию
PUT    /api/foreman/specs/:id/reject               отклонить с пояснением

-- Заявки на доп. материал
POST   /api/foreman/projects/:id/mtr-requests      создать заявку если не хватает
```

### /api/supplier
```
POST   /api/supplier/projects/join
GET    /api/supplier/projects/:id
GET    /api/supplier/projects/:id/mtr-requests
PUT    /api/supplier/mtr-requests/:id

-- Склад объекта
GET    /api/supplier/projects/:id/warehouse         склад объекта
POST   /api/supplier/projects/:id/warehouse         добавить материал на склад объекта
PUT    /api/supplier/warehouse/:id                  обновить остатки
GET    /api/supplier/projects/:id/warehouse/export  экспорт в Excel

-- Ведомость материалов
GET    /api/supplier/projects/:id/specs             ведомость по проекту
POST   /api/supplier/projects/:id/specs             создать позицию ведомости
PUT    /api/supplier/specs/:id                      редактировать позицию
POST   /api/supplier/projects/:id/specs/submit      отправить на согласование прорабу
DELETE /api/supplier/specs/:id                      удалить позицию (только draft)

-- Общий склад компании
GET    /api/supplier/general-warehouse              список позиций общего склада
POST   /api/supplier/general-warehouse              добавить позицию
PUT    /api/supplier/general-warehouse/:id          обновить количество
POST   /api/supplier/general-warehouse/:id/transfer перевести на склад объекта
```

### /api/pto
```
POST   /api/pto/projects/join
GET    /api/pto/projects/:id
GET    /api/pto/projects/:id/stages
POST   /api/pto/projects/:id/documents
GET    /api/pto/projects/:id/documents
DELETE /api/pto/documents/:id
```

### /api/customer
```
POST   /api/customer/requests
POST   /api/customer/projects/join
GET    /api/customer/projects/:id
GET    /api/customer/projects/:id/stages
GET    /api/customer/projects/:id/documents
```

### /api/partner
```
GET    /api/partner/stats
GET    /api/partner/refs
POST   /api/partner/payout-request
```

### Общие
```
GET    /api/messages
POST   /api/messages
GET    /api/notifications
PUT    /api/notifications/:id/read
GET    /api/documents/serve/:key   signed URL, TTL 1 час
```

---

## Матрица доступа

| Действие                   | Admin | Manager | Foreman | Supplier | PTO | Customer | Partner |
|----------------------------|:-----:|:-------:|:-------:|:--------:|:---:|:--------:|:-------:|
| Создать пользователя       | да    | —       | —       | —        | —   | —        | —       |
| Верифицировать регистрацию | да    | —       | —       | —        | —   | —        | —       |
| Создать проект             | да    | да      | —       | —        | —   | —        | —       |
| Видеть все проекты         | да    | да      | —       | —        | —   | —        | —       |
| Видеть свои проекты        | да    | да      | да      | да       | да  | да       | —       |
| Назначить команду          | да    | да      | —       | —        | —   | —        | —       |
| Присоединиться по коду     | —     | —       | да      | да       | да  | да       | —       |
| Создать/редактировать этап | да    | —       | да      | —        | —   | —        | —       |
| Загрузить фото этапа       | да    | —       | да      | —        | —   | —        | —       |
| Просмотр этапов            | да    | да      | да      | да       | да  | да       | —       |
| Создать заявку на МТР      | да    | —       | да      | —        | —   | —        | —       |
| Рассмотреть заявку МТР     | да    | —       | —       | да       | —   | —        | —       |
| Просмотр склада            | да    | —       | да      | да       | —   | —        | —       |
| Экспорт склада в Excel     | да    | —       | —       | да       | —   | —        | —       |
| Загрузить ИД               | да    | —       | —       | —        | да  | —        | —       |
| Загрузить договор/смету    | да    | да      | —       | —        | —   | —        | —       |
| Просмотр документов        | да    | да      | да      | —        | да  | да       | —       |
| Создать заявку из ЛК       | —     | —       | —       | —        | —   | да       | —       |
| Отправить сообщение        | да    | да      | —       | —        | —   | да       | —       |
| Дашборд метрик             | да    | —       | —       | —        | —   | —        | —       |
| AI-анализ смет             | да    | да      | —       | —        | —   | —        | —       |
| Статистика партнёра        | —     | —       | —       | —        | —   | —        | да      |
| Запросить выплату          | —     | —       | —       | —        | —   | —        | да      |

---

## Сайт — публичная часть

> Дизайн-система, стили и UI-детали описаны в frontend.md

### Страницы лендинга

**index.html** — секции сверху вниз:
1. Навбар — логотип, ссылки, кнопка "Войти"
2. Герой — видео на фоне (опора ВЛ 110 кВ), заголовок, кнопки "Оставить заявку" и "Наши объекты"
3. Стата — 4 показателя (110 кВ, 0.4 кВ, МСК, опыт)
4. Услуги — сетка 3×2, 6 карточек с номерами и стрелками
5. CTA-блок — призыв к действию
6. Форма заявки — POST /api/public/requests
7. Футер

**services.html** — услуги детально
**portfolio.html** — портфолио объектов
**partners.html** — описание партнёрской программы и уровней
**contact.html** — контакты
**login.html** — форма входа
**register.html** — регистрация заказчика

### Дашборды

Каждый дашборд проверяет сессию при загрузке. Нет сессии → редирект на /login.html.

**dashboard_manager.html** — воронка (Kanban), заявки, "Создать проект", почта, AI-анализ
**dashboard_foreman.html** — проекты, этапы, фото, заявки МТР, склад, "Присоединиться по коду"
**dashboard_supplier.html** — проекты, заявки от прораба, склад факт, экспорт Excel
**dashboard_pto.html** — проекты, этапы (просмотр), загрузка ИД, архив документов
**dashboard_customer.html** — объекты, ход СМР, документы, почта, "Создать заявку", "Присоединиться"
**dashboard_admin.html** — метрики, пользователи, проекты, выплаты партнёров
**dashboard_partner.html** — реф. код, уровень, статистика, "Запросить выплату"

---

## Безопасность

- Пароли: Argon2id
- Сессии: httpOnly, SameSite: lax, secure в prod
- Файлы: signed URL TTL 1 час, проверка прав в БД
- Rate limit: 5 входов / 15 мин, 3 регистрации / час
- Файлы: проверка MIME, максимум 10MB
- Секреты: только через .env

---

## Формат ответов API

```json
{ "success": true, "data": { } }
{ "success": false, "error": "Сообщение" }
```

Статусы: 200, 201, 400, 401, 403, 404, 500.
Все ошибки через `next(err)` → centralErrorHandler.

---

## .env

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/energoatlant
SESSION_SECRET=<64 символа>
YOS_BUCKET=energoatlant-files
YOS_ENDPOINT=https://storage.yandexcloud.net
YOS_ACCESS_KEY=
YOS_SECRET_KEY=
GEMINI_API_KEY=
```

---

## Запрещено

- SQLite — только PostgreSQL
- Supabase Storage — только Yandex Object Storage
- Локальное хранение файлов в продакшене
- Запросы к БД из роутов — только через контроллеры
- Возвращать password_hash в API-ответах
- SELECT * — всегда явно перечислять поля
- Игнорировать ошибки — всегда try/catch + next(err)
- Хардкодить роли строками — только ROLES константы
- Писать код "на будущее"

---

## Порядок разработки

1. `db/migrations/001_init.sql`
2. `config/`
3. `middleware/auth.js`
4. Роуты + контроллеры — по одной роли
5. Фронтенд — после готового API

---

_Последнее обновление: апрель 2026_
