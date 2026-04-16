const { Router } = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { getNotifications, markRead } = require('../controllers/notificationController');

const router = Router();

router.use(isAuthenticated);

router.get('/',             getNotifications);
router.put('/:id/read',     markRead);

module.exports = router;
