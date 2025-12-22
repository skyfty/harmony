#!/usr/bin/env node
/*
  Fix Node.js ESM relative imports in compiled JS by appending file extensions (.js) or /index.js
  when missing. This is needed because Node.js ESM does not perform extension or index resolution.

  This variant targets the schema package root (../) and skips node_modules.
*/
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

/** @param {string} p */
function hasKnownExt(p) {
  return /\.(mjs|cjs|js|json|node)$/i.test(p);
}

/**
 * @param {string} filePath absolute path to the JS file that contains the import
 * @param {string} specifier raw import specifier
 */
function rewriteSpecifier(filePath, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  if (hasKnownExt(specifier)) return null;

  const baseDir = path.dirname(filePath);
  const abs = path.resolve(baseDir, specifier);

  const fileJs = abs + '.js';
  const fileJson = abs + '.json';
  const fileNode = abs + '.node';
  const dirIndex = path.join(abs, 'index.js');

  if (fs.existsSync(fileJs)) return specifier + '.js';
  if (fs.existsSync(fileJson)) return specifier + '.json';
  if (fs.existsSync(fileNode)) return specifier + '.node';
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(dirIndex)) {
    return specifier.endsWith('/') ? specifier + 'index.js' : specifier + '/index.js';
  }
  return null;
}

/** @param {string} content @param {string} filePath */
function processFile(content, filePath) {
  let changed = false;

  content = content.replace(/(from\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (m, a, spec, b) => {
    const repl = rewriteSpecifier(filePath, spec);
    if (repl) {
      changed = true;
      return a + repl + b;
    }
    return m;
  });

  content = content.replace(/(import\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (m, a, spec, b) => {
    const repl = rewriteSpecifier(filePath, spec);
    if (repl) {
      changed = true;
      return a + repl + b;
    }
    return m;
  });

  content = content.replace(/(import\(\s*['"])(\.\.?\/[^'"\)]+)(['"][^)]*\))/g, (m, a, spec, b) => {
    const repl = rewriteSpecifier(filePath, spec);
    if (repl) {
      changed = true;
      return a + repl + b;
    }
    return m;
  });

  return { changed, content };
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(p);
      continue;
    }

    if (entry.isFile() && p.endsWith('.js')) {
      const src = fs.readFileSync(p, 'utf8');
      const { changed, content } = processFile(src, p);
      if (changed) {
        fs.writeFileSync(p, content, 'utf8');
      }
    }
  }
}

walk(ROOT_DIR);
