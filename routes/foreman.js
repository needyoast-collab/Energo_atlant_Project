const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getProjects,
  joinProject,
  getProject,
  getStages,
  createStage,
  updateStage,
  generateStagesFromVOR,
  uploadPhoto,
  getWarehouse,
  getStageWriteoffs,
  getStagePhotos,
  writeoffWarehouse,
  getMtrRequests,
  createMtrRequest,
  getSpecs,
  approveSpec,
  rejectSpec,
  getWorkSpecs,
  addWorkSpec,
  batchAddWorkSpecs,
  getProjectDocuments,
} = require('../controllers/foremanController');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(file.mimetype) ? true : new Error('Допустимые форматы: JPEG, PNG, WEBP, HEIC'));
  },
});

router.use(requireRole([ROLES.FOREMAN, ROLES.ADMIN]));

// Проекты
router.get('/projects', getProjects);
router.post('/projects/join', joinProject);
router.get('/projects/:id', getProject);

// Этапы (generate-from-vor до createStage — конкретный маршрут выше параметрического)
router.get('/projects/:id/stages', getStages);
router.post('/projects/:id/stages/generate-from-vor', generateStagesFromVOR);
router.post('/projects/:id/stages', createStage);
router.put('/stages/:id', updateStage);
router.post('/stages/:id/photos', upload.single('photo'), uploadPhoto);
router.get('/stages/:id/writeoffs', getStageWriteoffs);
router.get('/stages/:id/photos', getStagePhotos);

// Склад объекта
router.get('/projects/:id/warehouse', getWarehouse);
router.post('/warehouse/:id/writeoff', writeoffWarehouse);

// Заявки МТР
router.get('/projects/:id/mtr-requests', getMtrRequests);
router.post('/projects/:id/mtr-requests', createMtrRequest);

// Ведомость материалов
router.get('/projects/:id/specs', getSpecs);
router.put('/specs/:id/approve', approveSpec);
router.put('/specs/:id/reject', rejectSpec);

// ВОР (ведомость объёмов работ)
router.get('/projects/:id/work-specs', getWorkSpecs);
router.post('/projects/:id/work-specs', addWorkSpec);
router.post('/projects/:id/work-specs/batch', batchAddWorkSpecs);

// Документы
router.get('/projects/:id/documents', getProjectDocuments);

router.get('/catalog', require('../controllers/adminController').getCatalog);

module.exports = router;
