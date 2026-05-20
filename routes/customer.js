const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const { createMemoryUpload, CUSTOMER_REQUEST_FILE_MIME_TYPES, MB } = require('../utils/upload');
const {
  getProjects,
  createRequest,
  joinProject,
  getProject,
  getStages,
  getStagePhotos,
  getDocuments,
  getWarehouse,
  getCalendarPlan,
  approveStage,
} = require('../controllers/customerController');

const router = Router();

const upload = createMemoryUpload({
  allowedMimeTypes: CUSTOMER_REQUEST_FILE_MIME_TYPES,
  maxFileSize: 10 * MB,
  errorMessage: 'Недопустимый формат файла. Разрешены: Word, Excel, PDF, DWG, JPG, PNG, WEBP',
});

router.use(requireRole([ROLES.CUSTOMER, ROLES.ADMIN]));

router.get('/projects',                getProjects);
router.post('/requests',               upload.array('files', 10), createRequest);
router.post('/projects/join',          joinProject);
router.get('/projects/:id',            getProject);
router.get('/projects/:id/stages',     getStages);
router.get('/stages/:stageId/photos',                    getStagePhotos);
router.get('/projects/:id/documents',                    getDocuments);
router.get('/projects/:id/warehouse',                    getWarehouse);
router.get('/projects/:id/calendar-plan',                getCalendarPlan);
router.put('/projects/:projectId/stages/:stageId/approve', approveStage);

module.exports = router;
