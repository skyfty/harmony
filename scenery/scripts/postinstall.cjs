#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDirFiltered(srcDir, destDir, options) {
  const { shouldCopy } = options;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    const rel = path.relative(packageRoot, srcPath).replace(/\\/g, '/');
    if (!shouldCopy(rel, entry)) continue;

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function resolveConsumerRoot() {
  // npm sets INIT_CWD to the directory where the install was initiated.
  const initCwd = process.env.INIT_CWD;
  if (initCwd && path.isAbsolute(initCwd)) return initCwd;

  // Fallback: best-effort guess.
  return path.resolve(packageRoot, '..', '..', '..');
}

function installToUniModules(consumerRoot) {
  const destDir = path.join(consumerRoot, 'src', 'uni_modules', 'scenery');

  rmrf(destDir);

  copyDirFiltered(packageRoot, destDir, {
    shouldCopy: (rel, entry) => {
      // Keep uni_modules clean: do not copy installer scripts into app source.
      if (rel === 'scripts' || rel.startsWith('scripts/')) return false;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
      if (rel.startsWith('.git')) return false;
      if (rel === '.npmignore') return false;
      if (rel.endsWith('.log')) return false;
      if (rel === 'package-lock.json' || rel === 'pnpm-lock.yaml' || rel === 'yarn.lock') return false;

      // Only include directories/files we expect under a uni_modules module.
          const allowedRoots = ['package.json', 'components', 'common', 'static'];
      const first = rel.split('/')[0];
      if (!allowedRoots.includes(first)) return false;

      // Skip empty directories only created for scripts, etc.
      if (entry.isDirectory() && fs.readdirSync(path.join(packageRoot, rel)).length === 0) return false;

      return true;
    },
  });

  console.log(`[scenery] Installed uni_module -> ${path.relative(consumerRoot, destDir)}`);
}

try {
  const consumerRoot = resolveConsumerRoot();
  installToUniModules(consumerRoot);
  } catch (err) {
  console.warn('[scenery] postinstall failed:', err && err.message ? err.message : err);
  // Do not hard-fail install; build scripts can surface errors if module is missing.
  process.exitCode = 0;
}
