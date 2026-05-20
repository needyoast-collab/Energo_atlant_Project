const multer = require('multer');

const MB = 1024 * 1024;

const IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const FOREMAN_PHOTO_MIME_TYPES = Object.freeze([
  ...IMAGE_MIME_TYPES,
  'image/heic',
]);

const OFFICE_DOCUMENT_MIME_TYPES = Object.freeze([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const PROJECT_DOCUMENT_MIME_TYPES = Object.freeze([
  'application/pdf',
  ...IMAGE_MIME_TYPES,
  ...OFFICE_DOCUMENT_MIME_TYPES,
]);

const DWG_MIME_TYPES = Object.freeze([
  'image/vnd.dwg',
  'application/dwg',
  'application/acad',
  'application/x-dwg',
  'application/x-autocad',
  'image/x-dwg',
]);

const CUSTOMER_REQUEST_FILE_MIME_TYPES = Object.freeze([
  ...OFFICE_DOCUMENT_MIME_TYPES,
  'application/pdf',
  ...DWG_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
]);

function createMemoryUpload({ allowedMimeTypes, maxFileSize, errorMessage }) {
  const allowed = new Set(allowedMimeTypes);

  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize },
    fileFilter: (req, file, cb) => {
      if (allowed.has(file.mimetype)) {
        cb(null, true);
        return;
      }

      cb(new Error(errorMessage || 'Недопустимый формат файла'));
    },
  });
}

module.exports = {
  MB,
  IMAGE_MIME_TYPES,
  FOREMAN_PHOTO_MIME_TYPES,
  PROJECT_DOCUMENT_MIME_TYPES,
  CUSTOMER_REQUEST_FILE_MIME_TYPES,
  createMemoryUpload,
};
