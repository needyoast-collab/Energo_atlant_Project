const { Router } = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { getMessages, sendMessage, findUser } = require('../controllers/messageController');

const router = Router();

router.use(isAuthenticated);

router.get('/find-user', findUser);
router.get('/',          getMessages);
router.post('/',         sendMessage);

module.exports = router;
