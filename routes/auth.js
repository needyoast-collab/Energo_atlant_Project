const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { register, login, logout, me, forgotPassword, resetPassword } = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Слишком много попыток входа. Попробуйте через 15 минут' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, error: 'Слишком много регистраций. Попробуйте через час' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerLimiter, register);
router.post('/login',    loginLimiter,    login);
router.post('/logout',   isAuthenticated, logout);
router.get('/me',        isAuthenticated, me);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
