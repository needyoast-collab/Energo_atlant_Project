const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { createRequest } = require('../controllers/publicController');

const router = Router();

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Слишком много заявок. Попробуйте через час' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/requests', requestLimiter, createRequest);

module.exports = router;
