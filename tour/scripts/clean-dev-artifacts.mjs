import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFile);
const tourRoot = resolve(scriptDir, '..');
const targetPlatform = String(process.env.UNI_MP_PLATFORM || 'mp-weixin').trim();

if (!['mp-weixin', 'mp-toutiao', 'mp-xhs'].includes(targetPlatform)) {
  throw new Error(`Unsupported UNI_MP_PLATFORM: ${targetPlatform}`);
}

rmSync(resolve(tourRoot, `dist/dev/${targetPlatform}`), { recursive: true, force: true });
rmSync(resolve(tourRoot, 'node_modules/.vite'), { recursive: true, force: true });

console.log(`[harmony-tour] cleaned ${targetPlatform} dev artifacts`);
