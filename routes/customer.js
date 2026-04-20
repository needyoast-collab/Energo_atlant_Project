const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
const { getProjects, createRequest, joinProject, getProject, getStages, getStagePhotos, getDocuments, getWarehouse, approveStage } = require('../controllers/customerController');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 130 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf',
      'image/vnd.dwg',
      'application/dwg',
      'application/acad',
      'application/x-dwg',
      'application/x-autocad',
      'image/x-dwg',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый формат файла. Разрешены: Word, Excel, PDF, DWG'));
    }
  },
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
router.put('/projects/:projectId/stages/:stageId/approve', approveStage);

module.exports = router;
