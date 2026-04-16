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
  getPartnerPayouts,
  updatePartnerPayout,
} = require('../controllers/adminController');

const router = Router();

router.use(requireRole(ROLES.ADMIN));

router.get('/users',                  getUsers);
router.post('/users',                 createUser);
router.put('/users/:id',              updateUser);
router.delete('/users/:id',           deleteUser);
router.post('/users/:id/verify',      verifyUser);
router.post('/users/:id/restore',     restoreUser);
router.get('/metrics',                getMetrics);
router.get('/partner-payouts',        getPartnerPayouts);
router.put('/partner-payouts/:id',    updatePartnerPayout);

module.exports = router;
