function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.message, err.stack);

  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Внутренняя ошибка сервера'
    : err.message;

  res.status(status).json({ success: false, error: message });
}

module.exports = { errorHandler };
