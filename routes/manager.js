const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getRequests,
  updateRequest,
  getRequestFiles,
  getProjects,
  getProject,
  createProject,
  updateProject,
  copyRequestFiles,
  addTeamMember,
  analyzeProject,
  getStaff,
  getStages,
  createStage,
  updateStage,
  deleteStage,
  getWorkSpecs,
  addWorkSpec,
  updateWorkSpec,
  deleteWorkSpec,
  generateStagesFromVOR,
  getProjectWarehouse,
  getProjectSpecs,
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

router.get('/requests', getRequests);
router.put('/requests/:id', updateRequest);
router.get('/requests/:id/files', getRequestFiles);

router.get('/projects', getProjects);
router.post('/projects', createProject);
router.get('/projects/:id', getProject);
router.put('/projects/:id', updateProject);
router.post('/projects/:id/team', addTeamMember);
router.post('/projects/:id/copy-request-files', copyRequestFiles);
router.post('/projects/:id/analyze', analyzeProject);
router.post('/projects/:id/documents', upload.single('file'), uploadDocument);
router.get('/projects/:id/documents', getDocuments);

// specific before parametric
router.post('/projects/:id/stages/generate-from-vor', generateStagesFromVOR);
router.get('/projects/:id/stages', getStages);
router.post('/projects/:id/stages', createStage);

router.put('/stages/:stageId', updateStage);
router.delete('/stages/:stageId', deleteStage);

router.get('/projects/:id/work-specs', getWorkSpecs);
router.post('/projects/:id/work-specs', addWorkSpec);
router.put('/work-specs/:id', updateWorkSpec);
router.delete('/work-specs/:id', deleteWorkSpec);

router.get('/projects/:id/warehouse', getProjectWarehouse);
router.get('/projects/:id/specs', getProjectSpecs);

router.delete('/documents/:id', deleteDocument);
router.get('/doc-types', getDocTypes);
router.get('/staff', getStaff);

router.get('/catalog', require('../controllers/adminController').getCatalog);

module.exports = router;
