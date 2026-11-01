'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const out = path.join(root, 'docs');
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
html = html.replace('<script src="world.js"></script>', '<script>window.TECH_TANK_STATIC = true;</script>\n<script src="world.js"></script>');
html = html.replace('    <section class="block" id="faq">', '    <section class="block" id="registration-info"><h2 class="display">Participant access</h2><p class="lead">This is the public event website. Online account registration, payment uploads and participant sign-in will be available when the organisers connect the registration service.</p></section>\n    <section class="block" id="faq">');
html = html.replaceAll('href="/login"', 'href="#registration-info"');
fs.writeFileSync(path.join(out, 'index.html'), html);
let js = fs.readFileSync(path.join(root, 'public/world.js'), 'utf8');
js = js.replace("fetch('/api/content',", "fetch('./content.json',");
js = js.replace("codeCheck.src = '/icons/check.svg'", "codeCheck.src = './icons/check.svg'");
js = js.replace("  const e = C.event; const btn = $('#regButton'); const nav = $('#navRegister');", `  const e = C.event; const btn = $('#regButton'); const nav = $('#navRegister');
  if (window.TECH_TANK_STATIC) {
    const external = /^https:\\/\\//.test(e.registerUrl || '') ? e.registerUrl : '#registration-info';
    [btn, nav, $('#navPortal')].forEach(a => { a.href = external; });
    btn.textContent = external.startsWith('https:') ? 'Register for the event' : 'Registration information';
    nav.textContent = 'Register'; $('#navPortal').hidden = true;
    $('#regText').textContent = 'Four hours to build. One unexpected twist. See registration information for participant access.';
    return;
  }`);
js = js.replace('  refreshAccount();', '  if (!window.TECH_TANK_STATIC) refreshAccount();');
js = js.replace("if (!document.hidden) refreshAccount();", "if (!window.TECH_TANK_STATIC && !document.hidden) refreshAccount();");
js = js.replace("if ('EventSource' in window)", "if (!window.TECH_TANK_STATIC && 'EventSource' in window)");
js = js.replaceAll('href="/register"', 'href="#registration-info"').replaceAll('href="/portal"', 'href="#registration-info"');
fs.writeFileSync(path.join(out, 'world.js'), js);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('GitHub Pages 3D website built in docs/ (public data only).');
