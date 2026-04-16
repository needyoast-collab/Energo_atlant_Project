const { Router } = require('express');
const multer = require('multer');
const { requireRole, ROLES } = require('../middleware/auth');
const { getProjects, createRequest, joinProject, getProject, getStages, getDocuments, getWarehouse } = require('../controllers/customerController');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(requireRole([ROLES.CUSTOMER, ROLES.ADMIN]));

router.get('/projects',                getProjects);
router.post('/requests',               upload.single('file'), createRequest);
router.post('/projects/join',          joinProject);
router.get('/projects/:id',            getProject);
router.get('/projects/:id/stages',     getStages);
router.get('/projects/:id/documents',  getDocuments);
router.get('/projects/:id/warehouse',  getWarehouse);

module.exports = router;
