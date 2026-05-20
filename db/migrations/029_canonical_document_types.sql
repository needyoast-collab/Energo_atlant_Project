-- Миграция 029: приводим типы документов к названиям из AGENTS.md.

UPDATE project_documents
SET doc_type = CASE doc_type
  WHEN 'addendum' THEN 'additional_agreement'
  WHEN 'permit' THEN 'construction_permit'
  WHEN 'boundary_act' THEN 'arbp'
  ELSE doc_type
END
WHERE doc_type IN ('addendum', 'permit', 'boundary_act');

UPDATE public_request_files
SET doc_type = CASE doc_type
  WHEN 'addendum' THEN 'additional_agreement'
  WHEN 'permit' THEN 'construction_permit'
  WHEN 'boundary_act' THEN 'arbp'
  ELSE doc_type
END
WHERE doc_type IN ('addendum', 'permit', 'boundary_act');

ALTER TABLE project_documents DROP CONSTRAINT IF EXISTS project_documents_doc_type_check;
ALTER TABLE project_documents ADD CONSTRAINT project_documents_doc_type_check
  CHECK (doc_type IN (
    'rd','tu','pd','tz','construction_permit','arbp',
    'exec_scheme','hidden_works_act','geodetic_survey','general_works_log',
    'author_supervision','interim_acceptance','cable_test_act','measurement_protocol',
    'kp','estimate','contract','additional_agreement','ks2','ks3','other'
  ));
