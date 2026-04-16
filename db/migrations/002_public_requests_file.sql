-- Миграция 002: добавление полей doc_type и file_key в public_requests

ALTER TABLE public_requests
  ADD COLUMN IF NOT EXISTS doc_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS file_key TEXT;
