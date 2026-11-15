const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8');

test('Pages registration fallback exists and configured HTTPS registration opens correctly', () => {
  const html = read('index.html');
  assert.match(html, /id="registration-info"/);
  assert.match(html, /id="navRegister" href="#registration-info"/);
  const code = read('world.js');
  const render = code.slice(code.indexOf('function renderRegister()'), code.indexOf('function countdownBoxes('));
  for (const [url, expected] of [
    ['', '#registration-info'],
    ['https://registration.example/register', 'https://registration.example/register'],
    ['javascript:alert(1)', '#registration-info'],
    ['/register', '#registration-info'],
  ]) {
    const nodes = new Map();
    const $ = key => { if (!nodes.has(key)) nodes.set(key, {}); return nodes.get(key); };
    vm.runInNewContext(render + '\nrenderRegister();', { C: { event: { registerUrl: url } }, $, URL, window: { TECH_TANK_STATIC: true } });
    assert.equal($('#regButton').href, expected);
    assert.equal($('#navRegister').href, expected);
  }
});
