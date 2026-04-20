-- 006: связь ВОР с этапами работ

ALTER TABLE project_stages
  ADD COLUMN IF NOT EXISTS vor_item_id     INTEGER REFERENCES work_specs(id),
  ADD COLUMN IF NOT EXISTS unit            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS planned_value   NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS actual_value    NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_date    DATE,
  ADD COLUMN IF NOT EXISTS actual_date     DATE,
  ADD COLUMN IF NOT EXISTS note            TEXT,
  ADD COLUMN IF NOT EXISTS is_from_vor     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS customer_agreed BOOLEAN DEFAULT FALSE;

ALTER TABLE project_stages DROP CONSTRAINT IF EXISTS project_stages_status_check;
ALTER TABLE project_stages ADD CONSTRAINT project_stages_status_check
  CHECK (status IN ('pending','in_progress','done','planned','not_done'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stages_generated BOOLEAN DEFAULT FALSE;
