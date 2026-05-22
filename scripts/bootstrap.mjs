import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const packageRoots = {
  editor: resolve(repoRoot, 'editor'),
  exhibition: resolve(repoRoot, 'exhibition'),
  physicsAmmo: resolve(repoRoot, 'physics-ammo'),
  physicsBridge: resolve(repoRoot, 'physics-bridge'),
  physicsCannon: resolve(repoRoot, 'physics-cannon'),
  physicsCore: resolve(repoRoot, 'physics-core'),
  scenery: resolve(repoRoot, 'scenery'),
  schema: resolve(repoRoot, 'schema'),
  tools: resolve(repoRoot, 'tools'),
  tour: resolve(repoRoot, 'tour'),
  utils: resolve(repoRoot, 'utils'),
  viewer: resolve(repoRoot, 'viewer'),
};

const sharedBuildOrder = [
  'utils',
  'physicsCore',
  'physicsBridge',
  'schema',
  'tools',
];

const viewerBuildOrder = [
  ...sharedBuildOrder,
  'physicsAmmo',
  'physicsCannon',
];

const tourBuildOrder = viewerBuildOrder;

const viewerInstallOrder = [
  'viewer',
  ...viewerBuildOrder,
  'scenery',
];

const editorPrebuildInstallOrder = [
  'scenery',
  ...sharedBuildOrder,
  'physicsAmmo',
  'physicsCannon',
];

const tourInstallOrder = [
  'tour',
  ...viewerBuildOrder,
  'scenery',
];

const exhibitionInstallOrder = [
  'exhibition',
  'scenery',
  ...sharedBuildOrder,
];

export async function bootstrapViewerShared() {
  await installPackages(viewerInstallOrder);
  cleanPackageOutputs(viewerBuildOrder);
  await buildPackages(viewerBuildOrder);
  await installPackages(['viewer']);
  await syncViewerSharedArtifacts();
  rmSync(resolve(packageRoots.viewer, 'node_modules/.vite'), { recursive: true, force: true });
}

export async function bootstrapViewer(platform, phase = 'build') {
  if (platform === 'shared') {
    await bootstrapViewerShared();
    return;
  }
  await bootstrapViewerShared();
  await syncViewerScenery(platform, phase);
  cleanAppCaches('viewer', platform, phase);
}

export async function bootstrapEditor() {
  await installPackages(editorPrebuildInstallOrder);
  cleanPackageOutputs(viewerBuildOrder);
  await buildPackages(viewerBuildOrder);
  await installPackages(['editor']);
  cleanAppCaches('editor');
}


export async function bootstrapTour(platform, phase = 'build') {
  if (platform === 'shared') {
    await bootstrapTourShared();
    return;
  }
  await bootstrapTourShared();
  await syncTourScenery(platform, phase);
  cleanAppCaches('tour', platform, phase);
}

export async function bootstrapTourShared() {
  await installPackages(['utils', 'physicsCore']);
  cleanPackageOutputs(['utils', 'physicsCore']);
  await buildPackages(['utils', 'physicsCore']);

  await installPackages(['physicsBridge']);
  cleanPackageOutputs(['physicsBridge']);
  await buildPackages(['physicsBridge']);

  await installPackages(['physicsAmmo', 'physicsCannon']);
  cleanPackageOutputs(['physicsAmmo', 'physicsCannon']);
  await buildPackages(['physicsAmmo', 'physicsCannon']);

  await installPackages(['schema']);
  cleanPackageOutputs(['schema']);
  await buildPackages(['schema']);

  await installPackages(['tools']);
  cleanPackageOutputs(['tools']);
  await buildPackages(['tools']);

  await installPackages(['scenery']);
  await installPackages(['tour']);
  await syncTourSharedArtifacts();
  rmSync(resolve(packageRoots.tour, 'node_modules/.vite'), { recursive: true, force: true });
}

export async function bootstrapExhibition() {
  await installPackages(exhibitionInstallOrder);
  cleanPackageOutputs(sharedBuildOrder);
  await buildPackages(sharedBuildOrder);
  await syncScenery('exhibition', false);
  cleanAppCaches('exhibition');
}

async function installPackages(packageNames) {
  for (const packageName of unique(packageNames)) {
    await runPnpm(['install', '--frozen-lockfile', '--ignore-scripts'], packageRoots[packageName]);
  }
}

async function buildPackages(packageNames) {
  for (const packageName of packageNames) {
    await runPnpm(['run', 'build'], packageRoots[packageName]);
  }
}

function cleanPackageOutputs(packageNames) {
  for (const packageName of unique(packageNames)) {
    rmSync(resolve(packageRoots[packageName], 'dist'), { recursive: true, force: true });
  }
}

function cleanAppCaches(appName, platform = '', phase = 'build') {
  rmSync(resolve(packageRoots[appName], 'node_modules/.vite'), { recursive: true, force: true });
  rmSync(resolve(packageRoots[appName], 'dist'), { recursive: true, force: true });

  if ((appName === 'viewer' || appName === 'tour') && platform === 'mp' && phase === 'dev') {
    rmSync(resolve(packageRoots[appName], 'dist/dev/mp-weixin'), { recursive: true, force: true });
  }
}

async function syncViewerSharedArtifacts() {
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-schema',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.viewer);
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-scenery-mirrors',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.viewer);
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-physics',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.viewer);
}

async function syncTourSharedArtifacts() {
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-schema',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.tour);
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-scenery-mirrors',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.tour);
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-physics',
    '--repoRoot',
    '..',
    '--viewerRoot',
    '.',
  ], packageRoots.tour);
}

async function syncViewerScenery(platform, phase) {
  const useLink = platform === 'h5' && phase === 'dev';
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-scenery',
    '--mode',
    'subpackage-uni-modules',
    ...(useLink ? ['--link'] : []),
  ], packageRoots.viewer);
}

async function syncTourScenery(platform, phase) {
  const useLink = platform === 'h5' && phase === 'dev';
  await runNode([
    '../tools/dist/cli-bin.js',
    'sync-scenery',
    '--mode',
    'subpackage-uni-modules',
    ...(useLink ? ['--link'] : []),
  ], packageRoots.tour);
}

async function runPnpm(args, cwd) {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await run(pnpmCommand, args, cwd);
}

async function runNode(args, cwd) {
  await run('node', args, cwd);
}

async function run(command, args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', [command, ...args].map(escapeWindowsArg).join(' ')],
        {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            CI: 'true',
          },
          stdio: 'inherit',
        },
      )
    : spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI: 'true',
        },
        stdio: 'inherit',
      });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
  }
}

function unique(values) {
  return [...new Set(values)];
}

function escapeWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function printHelp() {
  console.log(`bootstrap helper

Usage:
  node scripts/bootstrap.mjs viewer <shared|mp|h5> <dev|build>
  node scripts/bootstrap.mjs tour <shared|mp|h5> <dev|build>
  node scripts/bootstrap.mjs editor
  node scripts/bootstrap.mjs exhibition

Examples:
  node scripts/bootstrap.mjs viewer shared
  node scripts/bootstrap.mjs viewer mp dev
  node scripts/bootstrap.mjs viewer h5 build
  node scripts/bootstrap.mjs tour shared
  node scripts/bootstrap.mjs tour mp dev
  node scripts/bootstrap.mjs tour h5 build
  node scripts/bootstrap.mjs editor
`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [, , target, platform = 'build', phase = 'build'] = process.argv;

  try {
    if (target === 'viewer') {
      if (platform !== 'shared' && platform !== 'mp' && platform !== 'h5') {
        throw new Error('viewer bootstrap requires a platform: shared, mp, or h5');
      }
      if (phase !== 'dev' && phase !== 'build') {
        throw new Error('viewer bootstrap requires a phase: dev or build');
      }
      await bootstrapViewer(platform, phase);
    } else if (target === 'tour') {
      if (platform !== 'shared' && platform !== 'mp' && platform !== 'h5') {
        throw new Error('tour bootstrap requires a platform: shared, mp, or h5');
      }
      if (phase !== 'dev' && phase !== 'build') {
        throw new Error('tour bootstrap requires a phase: dev or build');
      }
      await bootstrapTour(platform, phase);
    } else if (target === 'editor') {
      await bootstrapEditor();
    } else if (target === 'exhibition') {
      await bootstrapExhibition();
    } else {
      printHelp();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
