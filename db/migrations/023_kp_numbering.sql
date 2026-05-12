CREATE TABLE IF NOT EXISTS kp_number_counters (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS kp_number   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS kp_year     INTEGER,
  ADD COLUMN IF NOT EXISTS kp_sequence INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_documents_kp_year_sequence
  ON project_documents (kp_year, kp_sequence)
  WHERE doc_type = 'kp'
    AND kp_year IS NOT NULL
    AND kp_sequence IS NOT NULL;
