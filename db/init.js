const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map(r => r.name));

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`[DB] Migration applied: ${file}`);
    } catch (err) {
      // 42P07 — relation already exists, миграция уже была применена вручную
      if (err.code === '42P07' || err.code === '42701') {
        console.warn(`[DB] Migration skipped (already applied): ${file}`);
      } else {
        throw err;
      }
    }
    await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  }
}

module.exports = { runMigrations };
