const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  restoreUser,
  getMetrics,
  getProjects,
  getProjectHistory,
  getPartnerPayouts,
  updatePartnerPayout,
} = require('../controllers/adminController');

const router = Router();

router.use(requireRole(ROLES.ADMIN));

router.get('/users', getUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/restore', restoreUser);
router.get('/metrics', getMetrics);
router.get('/projects', getProjects);
router.get('/project-history', getProjectHistory);
router.get('/partner-payouts', getPartnerPayouts);
router.put('/partner-payouts/:id', updatePartnerPayout);

// CATALOG ENDPOINTS
router.get('/catalog', require('../controllers/adminController').getCatalog);
router.post('/catalog/bulk', require('../controllers/adminController').addCatalogBulk);
router.put('/catalog/:id', require('../controllers/adminController').updateCatalogItem);
router.post('/catalog/:id/approve', require('../controllers/adminController').approveCatalogItem);
router.delete('/catalog/:id', require('../controllers/adminController').deleteCatalogItem);

// COEFFICIENTS
router.get('/coefficients', require('../controllers/adminController').getCoefficients);
router.post('/coefficients', require('../controllers/adminController').createCoefficient);
router.put('/coefficients/:id', require('../controllers/adminController').updateCoefficient);
router.delete('/coefficients/:id', require('../controllers/adminController').deleteCoefficient);

module.exports = router;
