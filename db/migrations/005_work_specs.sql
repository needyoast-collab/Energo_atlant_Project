CREATE TABLE work_specs (
    id         SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    foreman_id INTEGER REFERENCES users(id),
    work_name  VARCHAR(200) NOT NULL,
    unit       VARCHAR(20),
    quantity   NUMERIC(12,3) NOT NULL,
    status     VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft','pending_approval','approved','rejected')),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
