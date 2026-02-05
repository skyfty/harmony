const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

for (const filename of ['terrain-scatter.js', 'terrain-scatter.d.ts']) {
  const src = path.resolve(__dirname, '..', filename);
  const dest = path.resolve(distDir, filename);
  if (!fs.existsSync(src)) {
    // source not present (we may be using a TS source); skip copy
    continue
  }
  fs.copyFileSync(src, dest);
}
