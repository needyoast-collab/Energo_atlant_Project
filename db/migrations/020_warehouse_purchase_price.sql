ALTER TABLE warehouse_project
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(15,2);
