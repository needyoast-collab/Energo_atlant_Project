# Деплой ЭнергоАтлант на VPS

Пошаговая инструкция первого развёртывания. Стек: Node.js 18+, PostgreSQL,
nginx, PM2. Фронт и бэк на одном домене.

---

## 0. Предварительно

На VPS должны быть установлены:

```bash
node -v      # 18+
psql --version
nginx -v
pm2 -v       # npm i -g pm2  (если нет)
```

DNS: A-записи `energoatlant.ru` и `www.energoatlant.ru` → IP сервера.

---

## 1. Код на сервер

```bash
cd /var/www
git clone <repo-url> energoatlant
cd energoatlant
npm ci --omit=dev
```

---

## 2. PostgreSQL

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE energoatlant;
CREATE USER energoatlant_user WITH ENCRYPTED PASSWORD 'СГЕНЕРИРОВАТЬ';
GRANT ALL PRIVILEGES ON DATABASE energoatlant TO energoatlant_user;
\q
```

Миграции применять вручную **не нужно** — они накатываются автоматически при
первом запуске сервера (`db/init.js`, таблица `_migrations`).

---

## 3. .env

```bash
cp .env.example .env
nano .env
```

Заполнить:
- `DATABASE_URL` — строка подключения к созданной БД
- `SESSION_SECRET`, `MOBILE_TOKEN_SECRET` — `openssl rand -hex 32` (по одному на каждый)
- `YOS_*` — ключи Yandex Object Storage
- `GEMINI_API_KEY` — для AI-анализа смет
- `SMTP_USER` / `SMTP_PASS` — почта Yandex (пароль приложения)
- `SMSRU_API_ID` — для SMS-кодов (если пусто, коды идут в консоль)
- `NODE_ENV=production`

---

## 4. Запуск через PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 logs energoatlant     # убедиться: «[SERVER] ... запущен на порту 3000»
                          # и «[DB] Migration applied: ...» по каждой миграции

# автозапуск при перезагрузке VPS
pm2 startup               # выполнить выведенную командой строку
pm2 save
```

Приложение слушает `127.0.0.1:3000`. Наружу его проксирует nginx.

---

## 5. nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/energoatlant
sudo ln -sf /etc/nginx/sites-available/energoatlant /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # если был дефолтный
sudo nginx -t
sudo systemctl reload nginx
```

`root` в конфиге указывает на `/var/www/energoatlant/public` — поправить, если
путь другой.

---

## 6. SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d energoatlant.ru -d www.energoatlant.ru
```

Certbot сам подставит пути сертификатов. После этого проверить, что блоки
`ssl_certificate` в nginx.conf совпадают с выданными (обычно
`/etc/letsencrypt/live/energoatlant.ru/`). Автопродление: `certbot renew --dry-run`.

---

## 7. Проверка после деплоя

- [ ] `https://energoatlant.ru` открывается, редирект с http → https работает
- [ ] `https://www.energoatlant.ru` → редирект на non-www
- [ ] Заявка с лендинга приходит на почту (проверить SMTP)
- [ ] Регистрация + вход в личный кабинет
- [ ] Загрузка файла (проверить связь с Yandex Object Storage)
- [ ] `https://energoatlant.ru/robots.txt` и `/sitemap.xml` отдаются
- [ ] Приватные страницы (`/manager_project.html` и др.) отдают noindex

---

## Обновление кода (последующие деплои)

```bash
cd /var/www/energoatlant
git pull
npm ci --omit=dev
pm2 reload energoatlant
```

Новые миграции применятся автоматически при перезапуске.

---

## Оптимизации (не блокируют запуск, сделать после)

- **hero-poster**: `ffmpeg -i public/img/hero.mp4 -vframes 1 public/img/hero-poster.webp`,
  затем раскомментировать TODO-блок в `index.html` (preload + poster на оба `<video>`).
- **Логотип**: `cwebp public/img/logo.png -o public/img/logo.webp -q 90`, заменить
  `logo.png` → `logo.webp` в HTML (прелоадер, navbar, footer).
