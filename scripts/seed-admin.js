require('dotenv').config();
const crypto = require('crypto');
const argon2 = require('argon2');
const { pool } = require('../config/database');

async function seedAdmin() {
  const email    = 'admin@energoatlant.ru';
  const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const name     = 'Администратор';

  const hash = await argon2.hash(password, { type: argon2.argon2id });

  const result = await pool.query(
    `INSERT INTO users (role, name, email, password_hash, is_verified)
     VALUES ('admin', $1, $2, $3, TRUE)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [name, email, hash]
  );

  if (result.rows.length === 0) {
    console.log('Админ уже существует, пропущено.');
    process.exit(0);
  }

  console.log('Админ создан:');
  console.log('  Email:   ', email);
  console.log('  Пароль:  ', password);
  console.log('Смени пароль после первого входа!');
  process.exit(0);
}

seedAdmin().catch(err => { console.error(err); process.exit(1); });
