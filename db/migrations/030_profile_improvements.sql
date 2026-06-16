-- Профиль: смена email с подтверждением, смена логина, настройки уведомлений

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_change_pending   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS email_change_code      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS email_change_expires   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_settings  JSONB NOT NULL DEFAULT '{}';
