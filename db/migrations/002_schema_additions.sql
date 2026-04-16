-- Дополнения к схеме: недостающие таблицы и колонки projects

-- Дополнительные колонки public_requests (используются customerController)
ALTER TABLE public_requests ADD COLUMN IF NOT EXISTS doc_type  VARCHAR(50);
ALTER TABLE public_requests ADD COLUMN IF NOT EXISTS file_key  TEXT;

-- Колонки projects, которых нет в 001_init.sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS object_type         VARCHAR(50);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS voltage_class       VARCHAR(50);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS work_types          TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_source         VARCHAR(50);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kp_sent_at          DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visit_scheduled_at  DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planned_start       DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planned_end         DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_name        VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_phone       VARCHAR(20);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_email       VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_org         VARCHAR(200);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes               TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS partner_id          INTEGER REFERENCES users(id);

-- Общий склад компании
CREATE TABLE IF NOT EXISTS warehouse_general (
  id            SERIAL PRIMARY KEY,
  material_name VARCHAR(200) NOT NULL,
  unit          VARCHAR(20),
  qty_total     NUMERIC(12,3) DEFAULT 0,
  qty_reserved  NUMERIC(12,3) DEFAULT 0,
  notes         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Склад объекта
CREATE TABLE IF NOT EXISTS warehouse_project (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  material_name   VARCHAR(200) NOT NULL,
  unit            VARCHAR(20),
  qty_total       NUMERIC(12,3) DEFAULT 0,
  qty_used        NUMERIC(12,3) DEFAULT 0,
  source          VARCHAR(20) DEFAULT 'purchase',
  general_item_id INTEGER REFERENCES warehouse_general(id),
  notes           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ведомость материалов
CREATE TABLE IF NOT EXISTS material_specs (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  supplier_id    INTEGER NOT NULL REFERENCES users(id),
  material_name  VARCHAR(200) NOT NULL,
  unit           VARCHAR(20),
  quantity       NUMERIC(12,3) NOT NULL,
  status         VARCHAR(20) DEFAULT 'draft',
  rejection_note TEXT,
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TIMESTAMPTZ,
  is_deleted     BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Ведомость объёмов работ (ВОР)
CREATE TABLE IF NOT EXISTS work_specs (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  foreman_id  INTEGER NOT NULL REFERENCES users(id),
  work_name   VARCHAR(200) NOT NULL,
  unit        VARCHAR(20),
  quantity    NUMERIC(12,3) NOT NULL,
  status      VARCHAR(20) DEFAULT 'draft',
  is_deleted  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Сброс паролей (1.3)
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(100) NOT NULL,
  token      VARCHAR(10) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Расширяем doc_type: добавляем финансовые типы документов
-- (CHECK-constraint нельзя ADD IF NOT EXISTS, поэтому дропаем старый и ставим новый)
ALTER TABLE project_documents DROP CONSTRAINT IF EXISTS project_documents_doc_type_check;
ALTER TABLE project_documents ADD CONSTRAINT project_documents_doc_type_check
  CHECK (doc_type IN (
    'hidden_works_act','exec_scheme','geodetic_survey','general_works_log',
    'author_supervision','interim_acceptance','cable_test_act','measurement_protocol',
    'rd','pd','tz','tu','kp','estimate','contract','addendum','ks2','ks3',
    'permit','boundary_act','other'
  ));
