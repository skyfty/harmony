#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const sceneryRoot = path.resolve(packageRoot, '..', 'scenery');

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDirFiltered(srcDir, destDir, options) {
  const { shouldCopy } = options;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    const rel = path.relative(sceneryRoot, srcPath).replace(/\\/g, '/');
    if (!shouldCopy(rel, entry)) continue;

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function installToSubpackageUniModules() {
  const destDir = path.join(packageRoot, 'src', 'pages', 'scenery', 'uni_modules', 'scenery');

  rmrf(destDir);

  copyDirFiltered(sceneryRoot, destDir, {
    shouldCopy: (rel, entry) => {
      if (!rel) return false;
      if (rel === 'scripts' || rel.startsWith('scripts/')) return false;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
      if (rel.startsWith('.git')) return false;
      if (rel === '.npmignore') return false;
      if (rel.endsWith('.log')) return false;
      if (rel === 'package-lock.json' || rel === 'pnpm-lock.yaml' || rel === 'yarn.lock') return false;

      const allowedRoots = ['package.json', 'components', 'common', 'static'];
      const first = rel.split('/')[0];
      if (!allowedRoots.includes(first)) return false;

      if (entry.isDirectory() && fs.readdirSync(path.join(sceneryRoot, rel)).length === 0) return false;
      return true;
    },
  });

  console.log(`[viewer] Installed scenery -> ${path.relative(packageRoot, destDir)}`);
}

try {
  if (!fs.existsSync(sceneryRoot)) {
    throw new Error(`Missing scenery package at ${sceneryRoot}`);
  }
  installToSubpackageUniModules();
} catch (err) {
  console.warn('[viewer] install-scenery-subpackage failed:', err && err.message ? err.message : err);
  process.exitCode = 1;
}
