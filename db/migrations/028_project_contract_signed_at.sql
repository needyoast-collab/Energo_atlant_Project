ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS contract_signed_at DATE;
