CREATE TABLE IF NOT EXISTS public_request_files (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
  file_key    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  doc_type    TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
