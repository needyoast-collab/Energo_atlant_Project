const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getProjects,
  joinProject,
  getProject,
  getStages,
  getMtrRequests,
  updateMtrRequest,
  getProjectDocuments,
  getGeneralWarehouse,
  addGeneralWarehouse,
  updateGeneralWarehouse,
  transferToProject,
  getWarehouse,
  addProjectWarehouse,
  exportWarehouse,
  getSpecs,
  addSpec,
  updateSpec,
  deleteSpec,
  fulfillSpec,
  submitSpecs,
  batchAddSpecs,
} = require('../controllers/supplierController');

const router = Router();

router.use(requireRole([ROLES.SUPPLIER, ROLES.ADMIN]));

// Проекты
router.get('/projects',                               getProjects);
router.post('/projects/join',                         joinProject);
router.get('/projects/:id',                           getProject);
router.get('/projects/:id/stages',                    getStages);

// Заявки МТР
router.get('/projects/:id/mtr-requests',              getMtrRequests);
router.put('/mtr-requests/:id',                       updateMtrRequest);

// Документы
router.get('/projects/:id/documents',                 getProjectDocuments);

// Общий склад компании
router.get('/general-warehouse',                      getGeneralWarehouse);
router.post('/general-warehouse',                     addGeneralWarehouse);
router.put('/general-warehouse/:id',                  updateGeneralWarehouse);
router.post('/general-warehouse/:id/transfer',        transferToProject);

// Склад объекта
router.get('/projects/:id/warehouse',                 getWarehouse);
router.post('/projects/:id/warehouse',                addProjectWarehouse);
router.get('/projects/:id/warehouse/export',          exportWarehouse);

// Ведомость материалов
router.get('/projects/:id/specs',                     getSpecs);
router.post('/projects/:id/specs',                    addSpec);
router.put('/specs/:id',                              updateSpec);
router.delete('/specs/:id',                           deleteSpec);
router.post('/specs/:id/fulfill',                     fulfillSpec);
router.post('/projects/:id/specs/submit',             submitSpecs);
router.post('/projects/:id/specs/batch',              batchAddSpecs);

module.exports = router;
