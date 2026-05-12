CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    VARCHAR(20) NOT NULL,
  device_name VARCHAR(100),
  is_active   BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user_active
  ON mobile_push_tokens (user_id, is_active);
