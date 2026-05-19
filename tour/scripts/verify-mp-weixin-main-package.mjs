import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = resolve(currentFile, '..');
const viewerRoot = resolve(scriptDir, '..');
const distRoot = resolve(viewerRoot, 'dist/build/mp-weixin');

const checkedFiles = [
  'app.js',
  'common/vendor.js',
  'pages/index/index.js',
];

for (const relativePath of checkedFiles) {
  const absolutePath = resolve(distRoot, relativePath);
  try {
    readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`Missing expected mp-weixin build artifact: ${absolutePath}`);
  }
}

console.log('[harmony-viewer] verified mp-weixin main package artifacts');
