CREATE TABLE price_catalog (
    id SERIAL PRIMARY KEY,
    item_type VARCHAR(20) NOT NULL, -- 'work' или 'material'
    item_name VARCHAR(200) NOT NULL UNIQUE,
    unit VARCHAR(20) NOT NULL,
    base_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
