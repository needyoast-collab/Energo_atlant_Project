const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const {
  register,
  login,
  mobileLogin,
  mobileLogout,
  logout,
  me,
  updateProfile,
  changePassword,
  uploadAvatar,
  forgotPassword,
  verifyCode,
  resetPassword,
  verifyRegistration,
  resendRegistrationCode,
} = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');
const { normalizeAuthContact } = require('../utils/authIdentity');
const { createMemoryUpload, IMAGE_MIME_TYPES, MB } = require('../utils/upload');

const router = Router();

const avatarUpload = createMemoryUpload({
  allowedMimeTypes: IMAGE_MIME_TYPES,
  maxFileSize: 2 * MB,
  errorMessage: 'Допустимые форматы: JPG, PNG, WEBP до 2 МБ',
});

function getAuthRateLimitKey(req) {
  const rawContact = req.body?.login || req.body?.contact || req.body?.email || req.body?.phone || req.ip;
  const contact = normalizeAuthContact(rawContact);
  return `auth:${contact.type}:${String(contact.normalized || contact.raw || req.ip).toLowerCase()}`;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const key = getAuthRateLimitKey(req);
    req.authRateLimitKey = key;
    return key;
  },
  message: { success: false, error: 'Слишком много попыток входа. Попробуйте через 15 минут' },
  standardHeaders: true,
  legacyHeaders: false,
});

function attachLoginRateLimitReset(req, res, next) {
  req.resetLoginRateLimit = () => loginLimiter.resetKey(req.authRateLimitKey || getAuthRateLimitKey(req));
  next();
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, error: 'Слишком много регистраций. Попробуйте через час' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerLimiter, register);
router.post('/register/verify', loginLimiter, verifyRegistration);
router.post('/register/resend', loginLimiter, resendRegistrationCode);
router.post('/login', loginLimiter, attachLoginRateLimitReset, login);
router.post('/mobile/login', loginLimiter, attachLoginRateLimitReset, mobileLogin);
router.get('/mobile/me', isAuthenticated, me);
router.post('/mobile/logout', isAuthenticated, mobileLogout);
router.post('/logout', isAuthenticated, logout);
router.get('/me', isAuthenticated, me);
router.put('/profile', isAuthenticated, updateProfile);
router.put('/password', isAuthenticated, changePassword);
router.post('/avatar', isAuthenticated, avatarUpload.single('avatar'), uploadAvatar);
router.post('/forgot-password', loginLimiter, forgotPassword);
router.post('/verify-code', loginLimiter, verifyCode);
router.post('/reset-password', loginLimiter, resetPassword);

module.exports = router;
