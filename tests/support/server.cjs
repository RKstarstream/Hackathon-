const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.join(__dirname, '..', '..');

exports.startServer = async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-tank-portal-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'server.js'), fs.readFileSync(path.join(root, 'server.js'), 'utf8')
    .replace('Number(process.env.PORT) || 3000', '0').replaceAll('${PORT}', '${server.address().port}'));
  fs.copyFileSync(path.join(root, 'participants.js'), path.join(dir, 'participants.js'));
  fs.copyFileSync(path.join(root, 'apps-script-sync.js'), path.join(dir, 'apps-script-sync.js'));
  for (const name of ['account.html', 'portal.html', 'portal.js', 'account.js', 'portal.css', 'index.html']) {
    fs.copyFileSync(path.join(root, 'public', name), path.join(dir, 'public', name));
  }
  const content = JSON.parse(fs.readFileSync(path.join(root, 'data/content.json'), 'utf8'));
  content.event.registrationDeadline = '2099-01-01T00:00:00Z';
  content.event.registrationOpen = true;
  content.question.revealAt = '2099-01-01T00:00:00Z';
  content.question.revealed = false;
  content.crisis.revealAt = '';
  content.crisis.revealed = false;
  content.crisis.statement = 'SECRET global twist instructions';
  content.results.published = false;
  fs.writeFileSync(path.join(dir, 'data/content.json'), JSON.stringify(content));
  let child, base;
  async function launch() {
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, ADMIN_PASSCODE: 'test-only', COOKIE_SECURE: '', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    base = await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Website: (http:\/\/localhost:\d+)/);
        if (match) resolve(match[1]);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Test server exited before listening')));
    });
  }
  async function stop() { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await launch();
  return {
    get base() { return base; }, dir, content,
    async restart() { await stop(); await launch(); },
    request(url, options = {}) { return fetch(base + url, options); },
    json(url, body, { cookie = '', method = 'POST', admin = false, headers = {} } = {}) {
      return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { 'x-admin-passcode': 'test-only' } : {}), ...headers }, body: JSON.stringify(body) });
    },
    publish() { return this.json('/api/content', content, { method: 'PUT', admin: true }); },
  };
};
