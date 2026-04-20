const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  verifyUser,
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
router.post('/users/:id/verify', verifyUser);
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

module.exports = router;

