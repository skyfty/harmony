const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

for (const filename of ['terrain-scatter.js', 'terrain-scatter.d.ts']) {
  const src = path.resolve(__dirname, '..', filename);
  const dest = path.resolve(distDir, filename);
  fs.copyFileSync(src, dest);
}
