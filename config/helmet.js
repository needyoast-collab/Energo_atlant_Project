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
const connectSrc = ["'self'"];

if (storageOrigin) {
  imgSrc.push(storageOrigin);
  connectSrc.push(storageOrigin);
}

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'fonts.googleapis.com'],
      styleSrcElem: ["'self'", 'fonts.googleapis.com'],
      styleSrcAttr: ["'none'"],
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
