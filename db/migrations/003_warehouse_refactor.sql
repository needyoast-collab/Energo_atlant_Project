CREATE TABLE warehouse_general (
    id              SERIAL PRIMARY KEY,
    material_name   VARCHAR(200) NOT NULL,
    unit            VARCHAR(20),
    qty_total       NUMERIC(12,3) DEFAULT 0,
    qty_reserved    NUMERIC(12,3) DEFAULT 0,
    notes           TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE warehouse_project (
    id                SERIAL PRIMARY KEY,
    project_id        INTEGER REFERENCES projects(id),
    material_name     VARCHAR(200) NOT NULL,
    unit              VARCHAR(20),
    qty_total         NUMERIC(12,3) DEFAULT 0,
    qty_used          NUMERIC(12,3) DEFAULT 0,
    source            VARCHAR(20) DEFAULT 'purchase',
    general_item_id   INTEGER REFERENCES warehouse_general(id),
    notes             TEXT,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE material_specs (
    id              SERIAL PRIMARY KEY,
    project_id      INTEGER REFERENCES projects(id),
    supplier_id     INTEGER REFERENCES users(id),
    material_name   VARCHAR(200) NOT NULL,
    unit            VARCHAR(20),
    quantity        NUMERIC(12,3) NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft','pending_approval','approved','rejected')),
    rejection_note  TEXT,
    approved_by     INTEGER REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    is_deleted      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
