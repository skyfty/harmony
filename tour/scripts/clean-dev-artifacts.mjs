import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFile);
const tourRoot = resolve(scriptDir, '..');

rmSync(resolve(tourRoot, 'dist/dev/mp-weixin'), { recursive: true, force: true });
rmSync(resolve(tourRoot, 'node_modules/.vite'), { recursive: true, force: true });

console.log('[harmony-tour] cleaned dev artifacts');
