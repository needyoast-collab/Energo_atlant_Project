CREATE TABLE IF NOT EXISTS project_coefficients (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  coefficient_id INTEGER NOT NULL REFERENCES price_coefficients(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, coefficient_id)
);
