import { readdirSync, rmSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function runCommand(command, args, cwd) {
  if (process.platform === 'win32') {
    const quoted = [command, ...args].map((part) => {
      if (/[\s"&()<>|^]/.test(part)) {
        return `"${part.replaceAll('"', '\\"')}"`;
      }
      return part;
    });

    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', quoted.join(' ')], {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Command failed: ${quoted.join(' ')}`);
    }

    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const printedArgs = args.join(' ');
    throw new Error(`Command failed: ${command} ${printedArgs}`);
  }
}

export function getProjectRoot() {
  return process.cwd();
}

export function getProjectName(projectRoot = getProjectRoot()) {
  return basename(projectRoot);
}

export function getLogPrefix(projectRoot = getProjectRoot()) {
  return `[harmony-${getProjectName(projectRoot)}]`;
}

export function cleanMpWeixinArtifacts(projectRoot = getProjectRoot()) {
  rmSync(resolve(projectRoot, 'dist/dev/mp-weixin'), { recursive: true, force: true });
  rmSync(resolve(projectRoot, 'node_modules/.vite'), { recursive: true, force: true });
}

export function verifyMpWeixinMainPackageArtifacts(projectRoot = getProjectRoot()) {
  const distRoot = resolve(projectRoot, 'dist/build/mp-weixin');
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
}

export function verifyMpWeixinMainPackageSource(projectRoot = getProjectRoot()) {
  const forbiddenPatterns = [
    "from 'three'",
    'from "three"',
    "from 'cannon-es'",
    'from "cannon-es"',
    "from 'ammojs3'",
    'from "ammojs3"',
    "import('three')",
    'import("three")',
    "import('cannon-es')",
    'import("cannon-es")',
    "import('ammojs3')",
    'import("ammojs3")',
    "from 'ammojs3/dist/ammo.wasm.js'",
    'from "ammojs3/dist/ammo.wasm.js"',
    "from 'ammojs3/dist/ammo.wasm.wasm?url'",
    'from "ammojs3/dist/ammo.wasm.wasm?url"',
    '@harmony/schema',
    '@harmony/physics-ammo',
    '@harmony/physics-cannon',
    '@harmony/physics-bridge/wechat',
    'uni_modules/scenery',
  ];

  const excludedDirectories = new Set([
    resolve(projectRoot, 'src/pages/scenery'),
    resolve(projectRoot, 'src/pages/physics-ammo'),
    resolve(projectRoot, 'src/pages/physics-cannon'),
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
      if (entry.isFile() && /\.(ts|tsx|js|jsx|vue|mjs|cjs)$/.test(entry.name)) {
        files.push(absolutePath);
      }
    }

    return files;
  }

  const sourceFiles = collectSourceFiles(resolve(projectRoot, 'src'));

  for (const absolutePath of sourceFiles) {
    const content = readFileSync(absolutePath, 'utf8');
    const relativePath = relative(projectRoot, absolutePath).replaceAll('\\', '/');

    for (const pattern of forbiddenPatterns) {
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
}

export function bootstrapSharedPackages(repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')) {
  const packages = [
    'utils',
    'physics-core',
    'physics-bridge',
    'schema',
    'tools',
    'physics-ammo',
    'physics-cannon',
  ];

  for (const packageName of packages) {
    rmSync(resolve(repoRoot, packageName, 'dist'), { recursive: true, force: true });
  }

  for (const packageName of packages) {
    runCommand('pnpm', ['--dir', resolve(repoRoot, packageName), 'run', 'build'], repoRoot);
  }
}
