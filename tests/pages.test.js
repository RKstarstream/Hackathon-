const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pages.config.json'), 'utf8'));
const APP = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';

function renderRegister(event, window) {
  const code = read('world.js');
  const render = code.slice(code.indexOf('function renderRegister()'), code.indexOf('function countdownBoxes('));
  const nodes = new Map();
  const $ = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, removeAttribute() {}, classList: { remove() {} } });
    return nodes.get(key);
  };
  vm.runInNewContext(render + '\nrenderRegister();', { C: { event }, $, URL, window, fmtDate: String });
  return $;
}

test('published docs/ match pages.config.json', () => {
  const html = read('index.html');
  if (config.webAppUrl) {
    assert.ok(html.includes(`window.TECH_TANK_APP = ${JSON.stringify(config.webAppUrl)}`));
    assert.ok(!html.includes('id="registration-info"'));
    assert.ok(read('world.js').includes(`href="${config.webAppUrl}?page=register"`));
  } else {
    assert.match(html, /id="registration-info"/);
    assert.match(html, /id="navRegister" href="#registration-info"/);
  }
  assert.ok(!/href="\/(?:login|register|portal)"/.test(html + read('world.js')), 'no links to server-only pages');
});

test('Pages registration fallback exists and configured HTTPS registration opens correctly', () => {
  for (const [url, expected] of [
    ['', '#registration-info'],
    ['https://registration.example/register', 'https://registration.example/register'],
    ['javascript:alert(1)', '#registration-info'],
    ['/register', '#registration-info'],
  ]) {
    const $ = renderRegister({ registerUrl: url }, { TECH_TANK_STATIC: true });
    assert.equal($('#regButton').href, expected);
    assert.equal($('#navRegister').href, expected);
  }
});

test('Pages buttons open the Apps Script register or sign-in page when the web app is configured', () => {
  const window = { TECH_TANK_STATIC: true, TECH_TANK_APP: APP };
  let $ = renderRegister({ registrationOpen: true, registrationDeadline: '2099-01-01T00:00:00Z' }, window);
  assert.equal($('#regButton').href, APP + '?page=register');
  assert.equal($('#navRegister').href, APP + '?page=register');
  assert.equal($('#navRegister').textContent, 'Register');
  assert.equal($('#navPortal').href, APP + '?page=login');
  assert.equal($('#navPortal').hidden, false);
  $ = renderRegister({ registrationOpen: true, registrationDeadline: '2020-01-01T00:00:00Z' }, window);
  assert.equal($('#regButton').href, APP + '?page=login');
  assert.equal($('#regButton').textContent, 'Participant sign in');
  assert.match($('#regText').textContent, /closed/);
  $ = renderRegister({ registrationOpen: false }, window);
  assert.equal($('#navRegister').href, APP + '?page=login');
});
