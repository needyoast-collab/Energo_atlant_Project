require('dotenv').config();
const argon2 = require('argon2');
const { pool } = require('../config/database');

async function seedAdmin() {
  const email    = 'admin@energoatlant.ru';
  const password = 'Admin1234!';
  const name     = 'Администратор';

  const hash = await argon2.hash(password, { type: argon2.argon2id });

  await pool.query(
    `INSERT INTO users (role, name, email, password_hash, is_verified)
     VALUES ('admin', $1, $2, $3, TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [name, email, hash]
  );

  console.log('Админ создан:');
  console.log('  Email:   ', email);
  console.log('  Пароль:  ', password);
  console.log('Смени пароль после первого входа!');
  process.exit(0);
}

seedAdmin().catch(err => { console.error(err); process.exit(1); });
