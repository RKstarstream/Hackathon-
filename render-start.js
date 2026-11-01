const fs = require('fs');
const path = require('path');

const storage = '/var/data/tech-tank';
fs.mkdirSync(storage, { recursive: true });

for (const [source, destination] of [
  ['data', 'data'],
  ['public/uploads', 'uploads'],
]) {
  const local = path.join(__dirname, source);
  const stored = path.join(storage, destination);

  // Copy the initial files only when setting up storage.
  if (!fs.existsSync(stored)) {
    if (fs.existsSync(local)) {
      fs.cpSync(local, stored, { recursive: true });
    } else {
      fs.mkdirSync(stored, { recursive: true });
    }
  }

  // Point the existing server at the persistent files.
  if (!fs.existsSync(local) || !fs.lstatSync(local).isSymbolicLink()) {
    if (fs.existsSync(local)) {
      fs.renameSync(local, local + '.seed');
    }
    fs.symlinkSync(stored, local, 'dir');
  }
}

require('./server.js');