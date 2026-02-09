#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const exhibitionRoot = path.resolve(__dirname, '..');
const srcModuleDir = path.resolve(exhibitionRoot, '..', 'scene-viewer', 'src', 'uni_modules', 'scene-viewer');
const destModuleDir = path.join(exhibitionRoot, 'src', 'uni_modules', 'scene-viewer');

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(srcModuleDir)) {
  console.error(`scene-viewer module not found at: ${srcModuleDir}`);
  process.exit(1);
}

rmrf(destModuleDir);
copyDir(srcModuleDir, destModuleDir);

console.log(`Synced scene-viewer uni_module -> ${path.relative(exhibitionRoot, destModuleDir)}`);
