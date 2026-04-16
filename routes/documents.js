const { Router } = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { serveDocument } = require('../controllers/documentController');

const router = Router();

router.use(isAuthenticated);

router.get('/serve/:key', serveDocument);

module.exports = router;
