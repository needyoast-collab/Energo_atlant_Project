ALTER TABLE project_stages
  ADD COLUMN IF NOT EXISTS is_calendar_mobilization BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_stages_one_mobilization
  ON project_stages (project_id)
  WHERE is_calendar_mobilization = TRUE AND is_deleted = FALSE;
