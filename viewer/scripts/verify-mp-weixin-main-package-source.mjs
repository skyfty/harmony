import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = resolve(currentFile, '..');
const viewerRoot = resolve(scriptDir, '..');

const ammoPackageName = ['ammo', 'js3'].join('');
const ammoBootstrapImportPath = `${ammoPackageName}/dist/ammo.wasm.js`;
const ammoWasmImportPath = `${ammoPackageName}/dist/ammo.wasm.wasm?url`;

const forbiddenPatterns = [
  "from 'three'",
  'from "three"',
  "from 'cannon-es'",
  'from "cannon-es"',
  `from '${ammoPackageName}'`,
  `from "${ammoPackageName}"`,
  "import('three')",
  'import("three")',
  "import('cannon-es')",
  'import("cannon-es")',
  `import('${ammoPackageName}')`,
  `import("${ammoPackageName}")`,
  `from '${ammoBootstrapImportPath}'`,
  `from "${ammoBootstrapImportPath}"`,
  `from '${ammoWasmImportPath}'`,
  `from "${ammoWasmImportPath}"`,
  '@harmony/schema',
  '@harmony/physics-ammo',
  '@harmony/physics-cannon',
  '@harmony/physics-bridge/wechat',
  'uni_modules/scenery',
];

const allowedMainPackageImports = new Set([
  '@harmony/schema',
]);

const excludedDirectories = new Set([
  resolve(viewerRoot, 'src/pages/scenery'),
  resolve(viewerRoot, 'src/pages/physics-ammo'),
  resolve(viewerRoot, 'src/pages/physics-cannon'),
]);

const hits = [];

function collectSourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirectories.has(absolutePath)) {
        continue;
      }
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      if (/\.(ts|tsx|js|jsx|vue|mjs|cjs)$/.test(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

const sourceFiles = collectSourceFiles(resolve(viewerRoot, 'src'));

for (const absolutePath of sourceFiles) {
  const content = readFileSync(absolutePath, 'utf8');
  const relativePath = absolutePath.slice(viewerRoot.length + 1).replaceAll('\\', '/');

  for (const pattern of forbiddenPatterns) {
    if (
      pattern === '@harmony/schema'
      && relativePath === 'src/main.ts'
      && [...allowedMainPackageImports].some((allowedPattern) => content.includes(allowedPattern))
    ) {
      continue;
    }
    if (content.includes(pattern)) {
      hits.push(`${relativePath} -> ${pattern}`);
    }
  }
}

if (hits.length > 0) {
  throw new Error(
    [
      'Main package source references a forbidden library or subpackage:',
      ...hits.map((hit) => `- ${hit}`),
    ].join('\n'),
  );
}

console.log('[harmony-viewer] verified mp-weixin main package source boundary');
