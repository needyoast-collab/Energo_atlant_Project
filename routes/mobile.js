const { Router } = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  registerPushToken,
  unregisterPushToken,
} = require('../controllers/mobileController');

const router = Router();

router.use(isAuthenticated);

router.post('/push-token', registerPushToken);
router.delete('/push-token', unregisterPushToken);

module.exports = router;
