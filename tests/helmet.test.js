process.env.YOS_ENDPOINT = 'https://storage.yandexcloud.net';

const test = require('node:test');
const assert = require('node:assert/strict');

const { helmetConfig } = require('../config/helmet');

function runHelmet() {
  const headers = {};
  const req = {
    method: 'GET',
    url: '/',
    headers: {},
    app: {},
    res: null,
  };
  const res = {
    headersSent: false,
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
    removeHeader(name) {
      delete headers[name];
    },
  };
  req.res = res;

  let nextError;
  helmetConfig(req, res, (err) => {
    nextError = err;
  });

  return { headers, nextError };
}

test('helmetConfig keeps CSP strict for scripts and inline styles', () => {
  const { headers, nextError } = runHelmet();
  const csp = headers['Content-Security-Policy'];

  assert.equal(nextError, undefined);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src-attr 'none'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.equal(csp.includes("'unsafe-inline'"), false);
  assert.equal(csp.includes("'unsafe-eval'"), false);
});

test('helmetConfig allows configured YOS endpoint for images and connections', () => {
  const { headers } = runHelmet();
  const csp = headers['Content-Security-Policy'];

  assert.match(csp, /img-src[^;]*https:\/\/storage\.yandexcloud\.net/);
  assert.match(csp, /connect-src[^;]*https:\/\/storage\.yandexcloud\.net/);
});

test('helmetConfig prevents framing by external sites', () => {
  const { headers } = runHelmet();

  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['Cross-Origin-Embedder-Policy'], undefined);
});
