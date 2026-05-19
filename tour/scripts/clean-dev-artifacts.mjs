import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFile);
const viewerRoot = resolve(scriptDir, '..');

rmSync(resolve(viewerRoot, 'dist/dev/mp-weixin'), { recursive: true, force: true });
rmSync(resolve(viewerRoot, 'node_modules/.vite'), { recursive: true, force: true });

console.log('[harmony-viewer] cleaned dev artifacts');
