const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getRequests,
  updateRequest,
  getProjects,
  createProject,
  updateProject,
  addTeamMember,
  analyzeProject,
  getStaff,
  uploadDocument,
  getDocuments,
  deleteDocument,
  getDocTypes,
} = require('../controllers/managerController');

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
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Недопустимый формат файла'));
  },
});

router.use(requireRole([ROLES.MANAGER, ROLES.ADMIN]));

router.get('/requests',                          getRequests);
router.put('/requests/:id',                      updateRequest);
router.get('/projects',                          getProjects);
router.post('/projects',                         createProject);
router.put('/projects/:id',                      updateProject);
router.post('/projects/:id/team',                addTeamMember);
router.post('/projects/:id/analyze',             analyzeProject);
router.post('/projects/:id/documents',           upload.single('file'), uploadDocument);
router.get('/projects/:id/documents',            getDocuments);
router.delete('/documents/:id',                  deleteDocument);
router.get('/doc-types',                         getDocTypes);
router.get('/staff',                             getStaff);

module.exports = router;
