ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS entity_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON notifications (entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;
