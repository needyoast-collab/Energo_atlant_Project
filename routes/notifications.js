const { Router } = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { getNotifications, markRead, markAllAsRead } = require('../controllers/notificationController');

const router = Router();

router.use(isAuthenticated);

router.get('/',             getNotifications);
router.put('/:id/read',     markRead);
router.post('/read-all',    markAllAsRead);

module.exports = router;
