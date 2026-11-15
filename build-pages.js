'use strict';
// Builds the static 3D website for GitHub Pages in docs/.
// GitHub Pages cannot run a server, so registration, sign in and the portal live on the Google Apps Script
// web app. Put its /exec address in pages.config.json ("webAppUrl") and the Register, Sign in and portal
// buttons open those pages. Without it, the buttons lead to a "Participant access" note instead.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const out = path.join(root, 'docs');

const configFile = path.join(root, 'pages.config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const appUrl = String(config.webAppUrl || '').trim();
if (appUrl && !/^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(appUrl)) {
  throw new Error('pages.config.json: "webAppUrl" must be your Google Apps Script web app address ending in /exec');
}
const appPage = (page) => `${appUrl}?page=${page}`;
// Each edit must apply, so a change in public/ cannot silently break the published site.
function edit(text, from, to, all = false) {
  if (!text.includes(from)) throw new Error(`build-pages: could not find ${JSON.stringify(from.slice(0, 80))}`);
  return all ? text.split(from).join(to) : text.replace(from, () => to);
}

fs.mkdirSync(out, { recursive: true });
for (const asset of ['world.css', 'icons', 'vendor']) fs.cpSync(path.join(root, 'public', asset), path.join(out, asset), { recursive: true });

// Use the server's public-content filter without starting a server or reading accounts.
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const filter = server.slice(server.indexOf('function isSealed('), server.indexOf('function writeContent('));
if (!filter.includes('function publicText(')) throw new Error('Public content filter not found');
const context = vm.createContext({ raw: fs.readFileSync(path.join(root, 'data/content.json'), 'utf8') });
const content = JSON.parse(vm.runInContext(filter + '\npublicText(raw)', context));
content.media = []; // Gallery is not part of the published public website.
fs.writeFileSync(path.join(out, 'content.json'), JSON.stringify(content, null, 2));

let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
html = edit(html, '<script src="world.js"></script>', `<script>window.TECH_TANK_STATIC = true;${appUrl ? ` window.TECH_TANK_APP = ${JSON.stringify(appUrl)};` : ''}</script>\n<script src="world.js"></script>`);
if (appUrl) {
  html = edit(html, 'href="/login"', `href="${appPage('login')}"`, true);
} else {
  html = edit(html, '<section class="block" id="faq">', '<section class="block" id="registration-info" tabindex="-1"><h2 class="display">Participant access</h2><p class="lead">Online registration is not connected yet. Please contact the organising team using the contact details below for registration assistance.</p></section>\n    <section class="block" id="faq">');
  html = edit(html, 'id="navRegister" href="#"', 'id="navRegister" href="#registration-info"');
  html = edit(html, 'id="regButton" href="#"', 'id="regButton" href="#registration-info"');
  html = edit(html, 'href="/login"', 'href="#registration-info"', true);
}
fs.writeFileSync(path.join(out, 'index.html'), html);

let js = fs.readFileSync(path.join(root, 'public/world.js'), 'utf8');
js = edit(js, "fetch('/api/content',", "fetch('./content.json',");
js = edit(js, "codeCheck.src = '/icons/check.svg'", "codeCheck.src = './icons/check.svg'");
js = edit(js, "  const e = C.event; const btn = $('#regButton'); const nav = $('#navRegister');", `  const e = C.event; const btn = $('#regButton'); const nav = $('#navRegister');
  if (window.TECH_TANK_STATIC && window.TECH_TANK_APP) {
    // Registration, sign in and the portal run on the Google Apps Script web app.
    const page = (name) => window.TECH_TANK_APP + '?page=' + name;
    const open = e.registrationOpen !== false && !(e.registrationDeadline && Date.now() > Date.parse(e.registrationDeadline));
    [btn, nav].forEach((a) => { a.removeAttribute('target'); a.classList.remove('off'); a.href = page(open ? 'register' : 'login'); });
    btn.textContent = open ? 'Create account & register' : 'Participant sign in';
    nav.textContent = open ? 'Register' : 'Sign in';
    $('#navPortal').href = page('login'); $('#navPortal').textContent = 'Participant sign in'; $('#navPortal').hidden = !open;
    $('#regText').textContent = open ? 'Create your participant account to register and access your portal.' + (e.registrationDeadline ? ' Registrations close ' + fmtDate(e.registrationDeadline) + '.' : '') : 'Registrations are closed. Existing participants can sign in to their portal.';
    return;
  }
  if (window.TECH_TANK_STATIC) {
    let external = '#registration-info';
    try { const url = new URL(e.registerUrl); if (url.protocol === 'https:') external = url.href; } catch {}
    [btn, nav, $('#navPortal')].forEach(a => { a.href = external; });
    btn.textContent = external.startsWith('https:') ? 'Register for the event' : 'Registration information';
    nav.textContent = 'Register'; $('#navPortal').hidden = true;
    $('#regText').textContent = 'Four hours to build. One unexpected twist. See registration information for participant access.';
    return;
  }`);
js = edit(js, '  refreshAccount();', '  if (!window.TECH_TANK_STATIC) refreshAccount();');
js = edit(js, "if (!document.hidden) refreshAccount();", "if (!window.TECH_TANK_STATIC && !document.hidden) refreshAccount();");
js = edit(js, "if ('EventSource' in window)", "if (!window.TECH_TANK_STATIC && 'EventSource' in window)");
for (const page of ['register', 'portal', 'login']) {
  js = edit(js, `href="/${page}"`, appUrl ? `href="${appPage(page)}"` : 'href="#registration-info"', true);
}
fs.writeFileSync(path.join(out, 'world.js'), js);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`GitHub Pages 3D website built in docs/ (public data only). Registration ${appUrl ? 'links to ' + appUrl : 'is not linked: set webAppUrl in pages.config.json'}.`);
