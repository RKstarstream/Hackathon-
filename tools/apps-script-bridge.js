/* Tech Tank: Google Apps Script client bridge.
   Built into every Apps Script page (see build-apps-script.js) so the website code in public/ runs unchanged:
   - fetch('/api/...') goes to the server's api() function through google.script.run
   - EventSource('/api/stream') becomes a light polling loop that pauses while the tab is hidden
   - links to /, /login, /register, /portal and /admin open the matching web app page (target _top)
   - participant sessions are kept in this browser, because Apps Script pages cannot set cookies */
(() => {
  'use strict';
  const CFG = window.TT_CONFIG || {};
  const PAGES = { '/': 'home', '/index.html': 'home', '/login': 'login', '/register': 'register', '/account.html': 'login', '/portal': 'portal', '/portal.html': 'portal', '/admin': 'admin', '/admin.html': 'admin' };
  const TOKEN_KEY = 'tt-session';
  const MAX_UPLOAD = 20 * 1024 * 1024;

  /* ---------- storage that survives blocked or partitioned browser storage ---------- */
  const memory = {};
  const stores = () => { const out = []; try { out.push(window.localStorage); } catch {} try { out.push(window.sessionStorage); } catch {} return out.filter(Boolean); };
  const store = {
    get(key) { for (const s of stores()) { try { const v = s.getItem(key); if (v) return v; } catch {} } return memory[key] || ''; },
    set(key, value) { memory[key] = value; for (const s of stores()) { try { s.setItem(key, value); return; } catch {} } },
    remove(key) { delete memory[key]; for (const s of stores()) { try { s.removeItem(key); } catch {} } },
  };

  if (window.AbortSignal && !AbortSignal.timeout) {
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
      return controller.signal;
    };
  }

  /* ---------- page URLs ---------- */
  function pageUrl(page, hash) {
    const base = CFG.base || '';
    const sep = base.includes('?') ? '&' : '?';
    const url = page && page !== 'home' ? base + sep + 'page=' + encodeURIComponent(page) : base;
    return url + (hash ? (hash[0] === '#' ? hash : '#' + hash) : '');
  }
  function pathUrl(path) {
    let u;
    try { u = new URL(path, 'https://tech-tank.invalid'); } catch { return null; }
    const page = PAGES[u.pathname.replace(/\/+$/, '') || '/'];
    return page ? pageUrl(page, u.hash) : null;
  }
  function fixLink(a) {
    const raw = a.getAttribute('href');
    if (!raw || raw[0] !== '/' || raw[1] === '/') return;
    const url = pathUrl(raw);
    if (!url) return;
    a.setAttribute('href', url);
    const target = (a.getAttribute('target') || '').toLowerCase();
    // Pages run inside a frame: same-window links must replace the whole web app page.
    if (!target || target === '_self' || target === '_parent') a.setAttribute('target', '_top');
  }
  const fixAll = (node) => {
    if (node.matches && node.matches('a[href^="/"]')) fixLink(node);
    if (node.querySelectorAll) node.querySelectorAll('a[href^="/"]').forEach(fixLink);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') { if (r.target.tagName === 'A') fixLink(r.target); }
      else r.addedNodes.forEach((n) => { if (n.nodeType === 1) fixAll(n); });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  document.addEventListener('DOMContentLoaded', () => fixAll(document));
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href^="/"]'); if (a) fixLink(a); }, true);

  /* ---------- server calls ---------- */
  function serverCall(req) {
    return new Promise((resolve, reject) => {
      const run = window.google && google.script && google.script.run;
      if (!run) { reject(new Error('Open this page from its Google Apps Script web app link.')); return; }
      run.withSuccessHandler(resolve)
        .withFailureHandler((err) => reject(err instanceof Error ? err : new Error(String((err && err.message) || err || 'Request failed'))))
        .api(req);
    });
  }
  const abortReason = (signal) => (signal.reason && signal.reason.name ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'));
  function withSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
    });
  }
  function toResponse(out) {
    const status = out && out.status >= 200 && out.status <= 599 ? out.status : 500;
    if (out && out.base64 != null) {
      const bin = atob(out.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const type = out.contentType || 'application/octet-stream';
      return new Response(new Blob([bytes], { type }), { status, headers: { 'Content-Type': type } });
    }
    return new Response(out && out.json != null ? out.json : JSON.stringify({ error: 'Could not complete the request. Please try again.' }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  const json = (status, body) => toResponse({ status, json: JSON.stringify(body) });

  // Latest public content. The live poll keeps it current, so periodic page refreshes need no extra request.
  let publicCache = CFG.boot ? { content: CFG.boot, at: Date.now() } : null;
  const PUBLIC_FRESH_MS = Math.max(15000, (CFG.pollMs || 5000) * 4);

  async function apiFetch(url, init) {
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const path = url.pathname;
    const passcode = headers.get('x-admin-passcode') || '';
    const token = store.get(TOKEN_KEY);
    if (!token && method === 'GET' && (path === '/api/account' || path === '/api/portal')) return json(401, { error: 'Please sign in' });
    if (method === 'GET' && path === '/api/content' && !passcode && publicCache && Date.now() - publicCache.at < PUBLIC_FRESH_MS) {
      return json(200, publicCache.content);
    }
    let body = init.body == null ? '' : init.body;
    if (typeof body !== 'string') body = await new Response(body).text();
    const out = await serverCall({ method, path, query: Object.fromEntries(url.searchParams), body, passcode, token });
    if (out && out.token) { store.set(TOKEN_KEY, out.token); delete out.token; }
    if (path === '/api/account/logout' && out && out.status < 300) store.remove(TOKEN_KEY);
    if (token && out && out.status === 401 && (path === '/api/account' || path === '/api/portal')) store.remove(TOKEN_KEY);
    if (method === 'GET' && path === '/api/content' && !passcode && out && out.status === 200) {
      try { publicCache = { content: JSON.parse(out.json), at: Date.now() }; } catch {}
    }
    return toResponse(out);
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    init = init || {};
    let url = null;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch {}
    if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('Network requests are not available'));
    }
    return withSignal(apiFetch(url, init), init.signal);
  };

  /* ---------- live updates: polling in place of server-sent events ---------- */
  const streams = new Set();
  const pollDelay = () => Math.round((CFG.pollMs || 5000) * (0.85 + Math.random() * 0.3));
  class PollingEventSource {
    constructor(url) {
      this.url = String(url); this.readyState = 0; this.withCredentials = false;
      this.onopen = null; this.onmessage = null; this.onerror = null;
      this.listeners = {}; this.version = CFG.version || ''; this.failures = 0; this.busy = false; this.closed = false; this.timer = 0;
      streams.add(this);
      this.schedule(this.version ? pollDelay() : 0);
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    close() { this.closed = true; this.readyState = 2; clearTimeout(this.timer); streams.delete(this); }
    emit(type, data) {
      const event = { type, data, lastEventId: '', target: this };
      const handlers = (this.listeners[type] || []).slice();
      if (typeof this['on' + type] === 'function') handlers.push(this['on' + type]);
      handlers.forEach((fn) => { try { fn.call(this, event); } catch (err) { setTimeout(() => { throw err; }); } });
    }
    schedule(ms) { clearTimeout(this.timer); if (!this.closed) this.timer = setTimeout(() => this.poll(), ms); }
    wake() { if (!this.closed && !this.busy) this.schedule(0); }
    async poll() {
      if (this.closed || this.busy) return;
      if (document.hidden) return; // resumes when the tab is visible again
      this.busy = true;
      try {
        const out = await serverCall({ method: 'GET', path: '/api/stream', query: { since: this.version } });
        if (!out || out.status !== 200) throw new Error('Update check failed');
        const data = JSON.parse(out.json);
        if (this.readyState !== 1) { this.readyState = 1; this.emit('open'); }
        if (data.content) publicCache = { content: data.content, at: Date.now() };
        else if (publicCache) publicCache.at = Date.now();
        if (data.version && data.version !== this.version) {
          this.version = data.version;
          if (data.content) this.emit('content', JSON.stringify(data.content));
        }
        this.failures = 0;
      } catch {
        this.failures++;
        this.readyState = 0;
        this.emit('error');
      } finally {
        this.busy = false;
        this.schedule(this.failures ? Math.min(60000, (CFG.pollMs || 5000) * 2 ** this.failures) : pollDelay());
      }
    }
  }
  const NativeEventSource = window.EventSource;
  window.EventSource = function EventSource(url, options) {
    let u = null;
    try { u = new URL(url, location.href); } catch {}
    if (u && u.origin === location.origin && u.pathname === '/api/stream') return new PollingEventSource(url);
    if (!NativeEventSource) throw new TypeError('EventSource is not supported');
    return new NativeEventSource(url, options);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) streams.forEach((s) => s.wake()); });
  addEventListener('online', () => streams.forEach((s) => s.wake()));

  /* ---------- Control Room uploads (replaces XMLHttpRequest for /api/upload) ---------- */
  class UploadRequest {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ''; this.headers = {}; this.onload = null; this.onerror = null; }
    open(method, url) { this.method = String(method).toUpperCase(); this.url = new URL(url, location.href); }
    setRequestHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); }
    finish(status, body) { this.status = status; this.responseText = typeof body === 'string' ? body : JSON.stringify(body); if (this.onload) this.onload(); }
    send(file) {
      if (!file || typeof file.size !== 'number') { this.finish(400, { error: 'Choose a file to upload' }); return; }
      if (file.size > MAX_UPLOAD) { this.finish(413, { error: 'Files up to 20 MB can be uploaded here. Add larger videos by YouTube or Google Drive link.' }); return; }
      const progress = (fraction) => { if (this.upload.onprogress) this.upload.onprogress({ loaded: fraction * file.size, total: file.size || 1, lengthComputable: true }); };
      const reader = new FileReader();
      reader.onprogress = (e) => { if (e.lengthComputable) progress(e.loaded / e.total * 0.4); };
      reader.onerror = () => { if (this.onerror) this.onerror(); };
      reader.onload = () => {
        let fraction = 0.45;
        progress(fraction);
        const creep = setInterval(() => { fraction = Math.min(0.95, fraction + 0.03); progress(fraction); }, 500);
        serverCall({
          method: this.method || 'POST', path: this.url.pathname, query: Object.fromEntries(this.url.searchParams),
          body: JSON.stringify({ data: String(reader.result).replace(/^data:[^,]*,/, ''), type: file.type }),
          passcode: this.headers['x-admin-passcode'] || '',
        }).then((out) => { clearInterval(creep); progress(1); this.finish(out.status, out.json); },
          () => { clearInterval(creep); if (this.onerror) this.onerror(); });
      };
      reader.readAsDataURL(file);
    }
  }

  /* ---------- page-to-page navigation ---------- */
  const NAV_TEXT = {
    '/login': ['Sign in to continue', 'Sign in to open your participant portal.', 'Sign in'],
    '/portal': ['You’re signed in', 'Your participant portal is ready.', 'Open my portal ↗'],
  };
  function showContinue(url, path, opts) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => showContinue(url, path, opts), { once: true }); return; }
    const defaults = NAV_TEXT[(path || '').split('#')[0]] || ['Continue', 'Open the next page to continue.', 'Continue ↗'];
    const [title, text, label] = [opts.title || defaults[0], opts.text || defaults[1], opts.label || defaults[2]];
    let box = document.getElementById('tt-continue');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tt-continue';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'tt-continue-title');
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(3,6,12,.82);backdrop-filter:blur(6px);font-family:Manrope,system-ui,sans-serif';
      document.body.appendChild(box);
    }
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const extra = path === '/login'
      ? `<a href="${esc(pageUrl('register'))}" target="_top" style="color:#9fe8ff">Create an account</a>`
      : opts.signOut ? '<button type="button" id="tt-continue-signout" style="background:none;border:0;color:#9fe8ff;font:inherit;cursor:pointer;text-decoration:underline">Not you? Sign out</button>' : '';
    box.innerHTML = `<div style="width:min(420px,100%);padding:28px;border-radius:16px;background:#0d1622;border:1px solid rgba(255,255,255,.12);color:#e9eef9;box-shadow:0 30px 80px -20px #000;text-align:center">
      <h2 id="tt-continue-title" style="margin:0 0 8px;font-size:1.4rem">${esc(title)}</h2>
      <p style="margin:0 0 20px;color:#a9b4c9;line-height:1.5">${esc(text)}</p>
      <a id="tt-continue-go" href="${esc(url)}" target="_top" style="display:inline-block;padding:13px 24px;border-radius:10px;background:#40d6ff;color:#001018;font-weight:700;text-decoration:none">${esc(label)}</a>
      <p style="margin:16px 0 0;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font-size:.9rem">${extra}<a href="${esc(pageUrl('home'))}" target="_top" style="color:#9fe8ff">Main website</a></p></div>`;
    const signOut = document.getElementById('tt-continue-signout');
    if (signOut) signOut.addEventListener('click', async () => {
      signOut.disabled = true;
      try { await fetch('/api/account/logout', { method: 'POST' }); } catch {}
      store.remove(TOKEN_KEY);
      box.remove();
    });
    document.getElementById('tt-continue-go').focus({ preventScroll: true });
  }
  function navigate(path, opts) {
    opts = opts || {};
    const url = pathUrl(path) || pageUrl('home');
    // Browsers let a framed page open another top-level page only shortly after a click or key press.
    const allowed = !navigator.userActivation || navigator.userActivation.isActive;
    if (allowed) { try { window.top.location.href = url; } catch {} }
    setTimeout(() => showContinue(url, path, opts), allowed ? 1200 : 0);
  }

  /* ---------- page specific ---------- */
  if ((CFG.page === 'login' || CFG.page === 'register') && store.get(TOKEN_KEY)) {
    // Signed-in participants go straight to their portal, as on the Node server.
    window.fetch('/api/account').then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (data && data.user) navigate('/portal', { title: 'You’re signed in', text: `Signed in as ${data.user.name}. Your participant portal is ready.`, signOut: true });
    }).catch(() => {});
  }
  if (CFG.page === 'portal') {
    // Keep portal sections (#question, #rules, ...) in the address bar so they can be bookmarked and shared.
    const follow = (loc) => { if (loc && loc.hash && location.hash.slice(1) !== loc.hash) location.hash = loc.hash; };
    document.addEventListener('DOMContentLoaded', () => {
      try { google.script.url.getLocation(follow); } catch {}
      // Address bar edits and back/forward in the browser switch sections too.
      try { google.script.history.setChangeHandler((e) => follow(e && e.location)); } catch {}
    });
    addEventListener('hashchange', () => { try { google.script.history.replace(null, { page: 'portal' }, location.hash.slice(1)); } catch {} });
  }

  window.TT = { page: CFG.page || 'home', base: CFG.base || '', url: pageUrl, pathUrl, navigate, UploadRequest };
})();
