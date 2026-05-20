const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const { createMemoryUpload, PROJECT_DOCUMENT_MIME_TYPES, MB } = require('../utils/upload');
const {
  getProjects,
  getDocTypes,
  joinProject,
  getProject,
  getStages,
  uploadDocument,
  getDocuments,
  deleteDocument,
} = require('../controllers/ptoController');

const router = Router();

const upload = createMemoryUpload({
  allowedMimeTypes: PROJECT_DOCUMENT_MIME_TYPES,
  maxFileSize: 10 * MB,
  errorMessage: 'Недопустимый формат файла',
});

router.use(requireRole([ROLES.PTO, ROLES.ADMIN]));

router.get('/projects',                 getProjects);
router.get('/doc-types',                getDocTypes);
router.post('/projects/join',           joinProject);
router.get('/projects/:id',             getProject);
router.get('/projects/:id/stages',      getStages);
router.post('/projects/:id/documents',  upload.single('file'), uploadDocument);
router.get('/projects/:id/documents',   getDocuments);
router.delete('/documents/:id',         deleteDocument);

module.exports = router;
