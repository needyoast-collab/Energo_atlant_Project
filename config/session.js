const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { pool } = require('./database');

const PgSession = connectPgSimple(session);

const sessionConfig = {
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  },
};

module.exports = { session, sessionConfig };
