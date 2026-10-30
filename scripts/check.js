const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const files = fs.readdirSync('src', { recursive: true })
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.join('src', file));
files.push('public/app.js');

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
