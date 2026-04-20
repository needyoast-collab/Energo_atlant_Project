require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { helmetConfig } = require('./config/helmet');
const { session, sessionConfig } = require('./config/session');
const { errorHandler } = require('./middleware/errorHandler');
const { runMigrations } = require('./db/init');

const app = express();

// Безопасность
app.use(helmetConfig);

// CORS — только для dev; в prod фронт и бэк на одном домене
if (process.env.NODE_ENV === 'development') {
  app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
}

// Таймаут запроса — 30 сек (защита от зависших AI-запросов и т.п.)
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(503).json({ success: false, error: 'Request timeout' });
    }
  });
  next();
});

// Парсинг тела запроса
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Сессии
app.use(session(sessionConfig));

// Статика (публичная папка)
app.use(express.static(path.join(__dirname, 'public')));

// Роуты (подключаются по мере готовности)
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/public',        require('./routes/public'));
app.use('/api/contact',       require('./routes/contact'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/manager',       require('./routes/manager'));
app.use('/api/foreman',       require('./routes/foreman'));
app.use('/api/supplier',      require('./routes/supplier'));
app.use('/api/pto',           require('./routes/pto'));
app.use('/api/customer',      require('./routes/customer'));
app.use('/api/partner',       require('./routes/partner'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/documents',     require('./routes/documents'));

// 404 для неизвестных API-маршрутов (чтобы не возвращать HTML)
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'API маршрут не найден' });
});

// SPA-фолбэк: все неизвестные GET → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Централизованный обработчик ошибок (всегда последний)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`[SERVER] ЭнергоАтлант запущен на порту ${PORT} (${process.env.NODE_ENV})`);
    });
  } catch (err) {
    console.error('[SERVER] Ошибка запуска:', err.message);
    process.exit(1);
  }
}

start();
