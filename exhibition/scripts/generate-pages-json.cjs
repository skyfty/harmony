#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');
const pagesDir = path.join(srcDir, 'pages');
const outputPath = path.join(srcDir, 'pages.json');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      results.push(fullPath);
    }
  }
  return results;
}

function toUniPagePath(absVueFile) {
  const relFromSrc = path.relative(srcDir, absVueFile).replace(/\\/g, '/');
  // relFromSrc like: pages/home/index.vue
  return relFromSrc.replace(/\.vue$/, '');
}

const vueFiles = walk(pagesDir);
const pagePaths = Array.from(new Set(vueFiles.map(toUniPagePath)));

const homeEntry = 'pages/home/index';
pagePaths.sort((a, b) => {
  if (a === homeEntry) return -1;
  if (b === homeEntry) return 1;
  return a.localeCompare(b);
});

const pages = pagePaths.map((p) => ({ path: p }));

const pagesJson = {
  pages,
  subPackages: [
    {
      root: 'uni_modules/scene-viewer/pages',
      name: 'scene-viewer',
      pages: [{ path: 'index' }],
    },
  ],
  globalStyle: {
    navigationStyle: 'custom',
    navigationBarTextStyle: 'white',
    navigationBarBackgroundColor: '#F8F8F8',
    backgroundColor: '#F8F8F8',
  },
};

fs.writeFileSync(outputPath, JSON.stringify(pagesJson, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outputPath}`);
