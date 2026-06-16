const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApiContext(overrides = {}) {
  const context = {
    console,
    fetch: overrides.fetch || (async () => ({ ok: true, status: 200, text: async () => '{}' })),
    FormData: class FormData {},
    IMask: Object.hasOwn(overrides, 'IMask') ? overrides.IMask : () => ({}),
    MutationObserver: class MutationObserver {
      observe() {}
    },
    document: {
      readyState: overrides.readyState || 'loading',
      body: {},
      addEventListener() {},
      createElement: () => ({ classList: { add() {} }, appendChild() {} }),
      getElementById: () => null,
      querySelectorAll: () => overrides.querySelectorAll || [],
    },
    setTimeout,
    URL,
    window: {
      location: { origin: 'https://energoatlant.ru' },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8'),
    context
  );
  return context;
}

test('safeUrl allows same-origin relative and http(s) document links', () => {
  const { safeUrl } = loadApiContext();

  assert.equal(safeUrl('/api/documents/serve/abc'), '/api/documents/serve/abc');
  assert.equal(
    safeUrl('https://storage.yandexcloud.net/bucket/file.pdf?X-Amz-Signature=abc'),
    'https://storage.yandexcloud.net/bucket/file.pdf?X-Amz-Signature=abc'
  );
});

test('safeUrl blocks executable, data and protocol-relative links', () => {
  const { safeUrl } = loadApiContext();

  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), '#');
  assert.equal(safeUrl('//evil.example/file.pdf'), '#');
});

test('escAttr and safeAttrUrl encode attribute-breaking characters', () => {
  const { escAttr, safeAttrUrl } = loadApiContext();

  assert.equal(escAttr('"x\'&<>'), '&quot;x&#39;&amp;&lt;&gt;');
  assert.equal(
    safeAttrUrl('/api/documents/serve/a?name="contract"&ok=1'),
    '/api/documents/serve/a?name=&quot;contract&quot;&amp;ok=1'
  );
});

test('api helpers do not crash when IMask is absent on pages with masked inputs', () => {
  const maskableInput = {
    matches: () => false,
    querySelectorAll: () => [],
    removeAttribute() {},
  };

  assert.doesNotThrow(() => loadApiContext({
    IMask: undefined,
    readyState: 'complete',
    querySelectorAll: [maskableInput],
  }));
});

test('apiRequest handles empty and non-json responses without throwing', async () => {
  const emptyContext = loadApiContext({
    fetch: async () => ({ ok: true, status: 204, text: async () => '' }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await emptyContext.apiRequest('GET', '/empty'))), {
    ok: true,
    status: 204,
    data: { success: true, data: null },
  });

  const htmlContext = loadApiContext({
    fetch: async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await htmlContext.apiRequest('GET', '/bad-gateway'))), {
    ok: false,
    status: 502,
    data: { success: false, error: 'Некорректный ответ сервера' },
  });
});
