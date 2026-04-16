const { Router } = require('express');
const { requireRole, ROLES } = require('../middleware/auth');
const { getStats, getRefs, requestPayout, getPayouts } = require('../controllers/partnerController');

const router = Router();

router.use(requireRole(ROLES.PARTNER));

router.get('/stats',           getStats);
router.get('/refs',            getRefs);
router.get('/payouts',         getPayouts);
router.post('/payout-request', requestPayout);

module.exports = router;
