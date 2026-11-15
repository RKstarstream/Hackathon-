'use strict';
// Local preview of the Google Apps Script web app, before deploying it.
//   npm run preview:apps-script                 then open http://localhost:8787/exec
//   node tools/preview-apps-script.js --port 9000 --latency 600 --open-registration
// Like Apps Script, each page runs inside a sandboxed frame on a different origin (127.0.0.1) than the
// outer page (localhost), and talks to the server only through google.script.run. Data is kept in memory.
const http = require('node:http');
const { createGas } = require('./gas-sim.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('port', process.env.PORT || 8787));
const LATENCY = Number(arg('latency', 250)); // Apps Script calls usually take a few hundred milliseconds
const OUTER = `http://localhost:${PORT}`;
const INNER = `http://127.0.0.1:${PORT}`;

const gas = createGas({ url: `${OUTER}/exec` });
gas.run('setup');
const passcode = gas.props.get('ADMIN_PASSCODE');
if (process.argv.includes('--open-registration')) {
  const content = gas.api({ method: 'GET', path: '/api/content', passcode }).body;
  content.event.registrationOpen = true;
  content.event.registrationDeadline = new Date(Date.now() + 30 * 864e5).toISOString();
  gas.api({ method: 'PUT', path: '/api/content', passcode, body: JSON.stringify(content) });
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SANDBOX = 'allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation';

function outerPage(query, title, metas) {
  return `<!doctype html><html><head><meta charset="utf-8">${Object.entries(metas).map(([n, c]) => `<meta name="${esc(n)}" content="${esc(c)}">`).join('')}
<title>${esc(title)}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#04050a}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe id="sandboxFrame" sandbox="${SANDBOX}" allow="autoplay; fullscreen; clipboard-write" src="${INNER}/__frame?${esc(query)}"></iframe>
<script>
addEventListener('message', (e) => {
  if (e.origin !== ${JSON.stringify(INNER)} || !e.data) return;
  if (e.data.type === 'tt-history') {
    const q = new URLSearchParams(e.data.params || {}).toString();
    history.replaceState(null, '', '/exec' + (q ? '?' + q : '') + (e.data.hash ? '#' + e.data.hash : ''));
  }
  if (e.data.type === 'tt-location') {
    e.source.postMessage({ type: 'tt-location-reply', id: e.data.id, location: here() }, e.origin);
  }
});
const here = () => ({ parameter: Object.fromEntries(new URLSearchParams(location.search)), hash: location.hash.slice(1) });
addEventListener('popstate', () => document.getElementById('sandboxFrame').contentWindow.postMessage({ type: 'tt-history-change', location: here() }, ${JSON.stringify(INNER)}));
</script></body></html>`;
}

// Stands in for the google.script API that Apps Script adds to every web app page.
const GOOGLE_SCRIPT = `<script>
(() => {
  const call = (name, args, ok, fail) => fetch('/__gs/' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    .then((r) => r.json()).then((d) => { if (d.error) throw new Error(d.error); return d.result; })
    .then((result) => ok && ok(result), (err) => fail ? fail(err) : console.error(err));
  const runner = (ok, fail) => new Proxy({}, { get: (_, name) => {
    if (name === 'withSuccessHandler') return (fn) => runner(fn, fail);
    if (name === 'withFailureHandler') return (fn) => runner(ok, fn);
    if (name === 'withUserObject') return () => runner(ok, fail);
    return (...args) => { call(String(name), args, ok, fail); };
  } });
  const pending = {};
  let changeHandler = null;
  addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tt-location-reply' && pending[e.data.id]) { pending[e.data.id](e.data.location); delete pending[e.data.id]; }
    if (e.data && e.data.type === 'tt-history-change' && changeHandler) changeHandler({ state: null, location: e.data.location });
  });
  window.google = { script: {
    run: runner(),
    history: {
      replace: (state, params, hash) => parent.postMessage({ type: 'tt-history', params, hash }, '*'),
      push: (state, params, hash) => parent.postMessage({ type: 'tt-history', params, hash }, '*'),
      setChangeHandler: (fn) => { changeHandler = fn; },
    },
    url: { getLocation: (cb) => { const id = Math.random().toString(36).slice(2); pending[id] = cb; parent.postMessage({ type: 'tt-location', id }, '*'); } },
    host: { close() {}, setHeight() {}, setWidth() {} },
  } };
})();
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, OUTER);
  const send = (status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    if (url.pathname === '/' ) { res.writeHead(302, { Location: `${OUTER}/exec` }); res.end(); return; }
    if (url.pathname === '/exec' && req.method === 'GET') {
      const output = gas.doGet(Object.fromEntries(url.searchParams));
      return send(200, outerPage(url.searchParams.toString(), output.getTitle(), output.metas));
    }
    if (url.pathname === '/__frame' && req.method === 'GET') {
      const html = gas.doGet(Object.fromEntries(url.searchParams)).getContent();
      return send(200, html.replace(/<head>/i, (m) => m + '\n' + GOOGLE_SCRIPT));
    }
    if (url.pathname.startsWith('/__gs/') && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => setTimeout(() => {
        let payload;
        try { payload = { result: gas.run(decodeURIComponent(url.pathname.slice(6)), ...JSON.parse(Buffer.concat(chunks).toString('utf8'))) }; }
        catch (err) { payload = { error: `ScriptError: ${err.message}` }; }
        send(200, JSON.stringify(payload), 'application/json; charset=utf-8');
      }, LATENCY));
      return;
    }
    send(404, 'Not found', 'text/plain');
  } catch (err) {
    console.error(err);
    send(500, 'Preview error: ' + esc(err.message));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Tech Tank Apps Script preview (in-memory data, ${LATENCY} ms simulated latency)`);
  console.log(`  Website:      ${OUTER}/exec`);
  console.log(`  Register:     ${OUTER}/exec?page=register`);
  console.log(`  Sign in:      ${OUTER}/exec?page=login`);
  console.log(`  Portal:       ${OUTER}/exec?page=portal`);
  console.log(`  Control Room: ${OUTER}/exec?page=admin   (passcode: ${passcode})\n`);
});
