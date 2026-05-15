import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = resolve(currentFile, '..');
const viewerRoot = resolve(scriptDir, '..');

const checkedFiles = [
  'src/main.ts',
  'src/App.vue',
  'src/pages/index/index.vue',
];

const forbiddenPatterns = [
  'from \'./pages/scenery/',
  'from "./pages/scenery/',
  "from '@/pages/scenery/",
  'from \'./pages/physics-ammo/',
  'from "./pages/physics-ammo/',
  "from '@/pages/physics-ammo/",
  'from \'./pages/physics-cannon/',
  'from "./pages/physics-cannon/',
  "from '@/pages/physics-cannon/",
  'from \'./pages/scenery/schema',
  'from "./pages/scenery/schema',
  "from '@/pages/scenery/schema",
  '@harmony/schema',
  '@harmony/physics-ammo',
  '@harmony/physics-cannon',
  '@harmony/physics-bridge/wechat',
  'uni_modules/scenery',
];

const hits = [];

for (const relativePath of checkedFiles) {
  const absolutePath = resolve(viewerRoot, relativePath);
  let content = '';

  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`Missing expected source file: ${absolutePath}`);
  }

  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      hits.push(`${relativePath} -> ${pattern}`);
    }
  }
}

if (hits.length > 0) {
  throw new Error(
    [
      'Main package source references a subpackage or physics module:',
      ...hits.map((hit) => `- ${hit}`),
    ].join('\n'),
  );
}

console.log('[harmony-viewer] verified mp-weixin main package source boundary');
