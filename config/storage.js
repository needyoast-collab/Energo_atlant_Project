const { S3Client } = require('@aws-sdk/client-s3');

const REQUIRED = ['YOS_BUCKET', 'YOS_ENDPOINT', 'YOS_ACCESS_KEY', 'YOS_SECRET_KEY'];
const missing = REQUIRED.filter(k => !process.env[k]);

let s3 = null;
let BUCKET = null;

if (missing.length) {
  console.warn(`[storage] Предупреждение: не заданы ${missing.join(', ')}. Хранилище недоступно.`);
} else {
  s3 = new S3Client({
    region: 'ru-central1',
    endpoint: process.env.YOS_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.YOS_ACCESS_KEY,
      secretAccessKey: process.env.YOS_SECRET_KEY,
    },
  });
  BUCKET = process.env.YOS_BUCKET;
}

module.exports = { s3, BUCKET };
