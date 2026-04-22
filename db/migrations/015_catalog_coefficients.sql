-- Переименование в AGENTS.md (информационно)
-- Создание таблицы коэффициентов
CREATE TABLE IF NOT EXISTS price_coefficients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  value NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Начальные данные
INSERT INTO price_coefficients (name, value, description) VALUES
('Стесненность', 1.2, 'Работа в стесненных условиях'),
('Высотность (до 5м)', 1.15, 'Работа на высоте до 5 метров'),
('Срочность', 1.5, 'Срочное выполнение работ')
ON CONFLICT (name) DO NOTHING;
