-- Индексы под частые табличные выборки в кабинетах

CREATE INDEX IF NOT EXISTS idx_projects_manager_active_created
  ON projects (manager_id, created_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_projects_active_created
  ON projects (created_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_project_members_user_role_project
  ON project_members (user_id, role, project_id);

CREATE INDEX IF NOT EXISTS idx_project_members_project_role_user
  ON project_members (project_id, role, user_id);

CREATE INDEX IF NOT EXISTS idx_project_stages_project_active_order
  ON project_stages (project_id, order_num, created_at)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_stage_photos_stage_uploaded
  ON stage_photos (stage_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_material_requests_project_created
  ON material_requests (project_id, created_at DESC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_material_specs_project_status_created
  ON material_specs (project_id, status, created_at)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_material_specs_project_supplier_status
  ON material_specs (project_id, supplier_id, status)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_warehouse_project_project_material
  ON warehouse_project (project_id, material_name);

CREATE INDEX IF NOT EXISTS idx_project_documents_project_uploaded
  ON project_documents (project_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON notifications (user_id, is_read, created_at DESC);
