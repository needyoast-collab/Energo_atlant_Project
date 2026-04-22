const helmet = require('helmet');

function getStorageOrigin() {
  const endpoint = process.env.YOS_ENDPOINT;
  if (!endpoint) return null;

  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

const storageOrigin = getStorageOrigin();
const imgSrc = ["'self'", 'data:', 'storage.yandexcloud.net'];
const connectSrc = ["'self'", 'unpkg.com'];

if (storageOrigin) {
  imgSrc.push(storageOrigin);
  connectSrc.push(storageOrigin);
}

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'unpkg.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc,
      connectSrc,
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", 'https://yandex.ru', 'https://*.yandex.ru', 'https://*.yandex.net'],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

module.exports = { helmetConfig };
