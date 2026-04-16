const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
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

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый формат файла'));
    }
  },
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
