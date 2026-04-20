CREATE TABLE IF NOT EXISTS project_history (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  changed_by INTEGER REFERENCES users(id),
  action     VARCHAR(50) NOT NULL,
  field_name VARCHAR(100),
  old_value  TEXT,
  new_value  TEXT,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_history_project_id_created_at
  ON project_history (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_history_changed_by_created_at
  ON project_history (changed_by, created_at DESC);
