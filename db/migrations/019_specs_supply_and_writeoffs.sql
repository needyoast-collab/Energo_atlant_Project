ALTER TABLE warehouse_project
  ADD COLUMN IF NOT EXISTS spec_id INTEGER REFERENCES material_specs(id);

CREATE TABLE IF NOT EXISTS warehouse_writeoffs (
  id SERIAL PRIMARY KEY,
  warehouse_item_id INTEGER NOT NULL REFERENCES warehouse_project(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  stage_id INTEGER NOT NULL REFERENCES project_stages(id),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  written_off_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
