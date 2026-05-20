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
  getCatalog,
  addCatalogBulk,
  updateCatalogItem,
  approveCatalogItem,
  deleteCatalogItem,
  getCoefficients,
  createCoefficient,
  updateCoefficient,
  deleteCoefficient,
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
router.get('/catalog', getCatalog);
router.post('/catalog/bulk', addCatalogBulk);
router.put('/catalog/:id', updateCatalogItem);
router.post('/catalog/:id/approve', approveCatalogItem);
router.delete('/catalog/:id', deleteCatalogItem);

// COEFFICIENTS
router.get('/coefficients', getCoefficients);
router.post('/coefficients', createCoefficient);
router.put('/coefficients/:id', updateCoefficient);
router.delete('/coefficients/:id', deleteCoefficient);

module.exports = router;
