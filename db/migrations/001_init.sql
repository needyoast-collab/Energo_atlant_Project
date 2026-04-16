-- ЭнергоАтлант — начальная миграция
-- Все таблицы создаются только если не существуют

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','manager','foreman','supplier','pto','customer','partner')),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_verified   BOOLEAN DEFAULT FALSE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(20) UNIQUE NOT NULL,
  name           VARCHAR(200) NOT NULL,
  status         VARCHAR(30) DEFAULT 'lead' CHECK (status IN ('lead','qualification','visit','offer','negotiation','contract','work','won','lost')),
  description    TEXT,
  address        VARCHAR(300),
  contract_value NUMERIC(15,2),
  manager_id     INTEGER REFERENCES users(id),
  is_deleted     BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  role       VARCHAR(20) NOT NULL,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public_requests (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100),
  phone       VARCHAR(20),
  email       VARCHAR(100),
  message     TEXT,
  status      VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new','in_progress','done','rejected')),
  assigned_to INTEGER REFERENCES users(id),
  is_deleted  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_stages (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  name          VARCHAR(200) NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  order_num     INTEGER DEFAULT 0,
  planned_start DATE,
  planned_end   DATE,
  actual_end    DATE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stage_photos (
  id          SERIAL PRIMARY KEY,
  stage_id    INTEGER NOT NULL REFERENCES project_stages(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  file_key    TEXT NOT NULL,
  description TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_requests (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  stage_id      INTEGER REFERENCES project_stages(id),
  foreman_id    INTEGER NOT NULL REFERENCES users(id),
  supplier_id   INTEGER REFERENCES users(id),
  material_name VARCHAR(200) NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL,
  unit          VARCHAR(20),
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','ordered','delivered')),
  notes         TEXT,
  is_deleted    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_items (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  material_name VARCHAR(200) NOT NULL,
  unit          VARCHAR(20),
  qty_planned   NUMERIC(12,3) DEFAULT 0,
  qty_received  NUMERIC(12,3) DEFAULT 0,
  qty_used      NUMERIC(12,3) DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_documents (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  doc_type    VARCHAR(50) CHECK (doc_type IN ('hidden_works_act','exec_scheme','geodetic_survey','general_works_log','author_supervision','interim_acceptance','cable_test_act','measurement_protocol','other')),
  file_key    TEXT NOT NULL,
  file_name   VARCHAR(200) NOT NULL,
  description TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  project_id  INTEGER REFERENCES projects(id),
  subject     VARCHAR(200),
  body        TEXT NOT NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id),
  type       VARCHAR(30) NOT NULL CHECK (type IN ('photo','document','status','message','mtr')),
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_refs (
  id               SERIAL PRIMARY KEY,
  partner_id       INTEGER NOT NULL REFERENCES users(id),
  referred_user_id INTEGER NOT NULL REFERENCES users(id),
  status           VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  commission       NUMERIC(10,2) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_payouts (
  id              SERIAL PRIMARY KEY,
  partner_id      INTEGER NOT NULL REFERENCES users(id),
  amount          NUMERIC(10,2) NOT NULL,
  payment_details TEXT NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected')),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Сессии (connect-pg-simple создаёт таблицу сам, но укажем явно для ясности)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
