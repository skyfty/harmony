#!/usr/bin/env node
/*
  Fix ESM relative imports in compiled JS by appending file extensions (.js) or /index.js
  when missing. This is needed because Node.js ESM does not perform extension or index
  resolution. Run after tsc (and tsc-alias) so paths are already rewritten to relative.
*/
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

/** @param {string} p */
function hasKnownExt(p) {
  return /\.(mjs|cjs|js|json|node)$/i.test(p);
}

/**
 * Resolve a specifier relative to a file path and decide the concrete file path
 * to use for Node ESM: either specifier + .js, or specifier + /index.js
 * Returns the rewritten specifier string, or null if no change is needed or target not found.
 * @param {string} filePath absolute path to the JS file that contains the import
 * @param {string} specifier the raw import specifier (relative, like ./foo or ../bar/baz)
 */
function rewriteSpecifier(filePath, specifier) {
  // Ignore non-relative
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  // If it already has an extension, leave it
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

  // from '...'
  content = content.replace(/(from\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (m, a, spec, b) => {
    const repl = rewriteSpecifier(filePath, spec);
    if (repl) {
      changed = true;
      return a + repl + b;
    }
    return m;
  });

  // side-effect import '...'
  content = content.replace(/(import\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (m, a, spec, b) => {
    const repl = rewriteSpecifier(filePath, spec);
    if (repl) {
      changed = true;
      return a + repl + b;
    }
    return m;
  });

  // dynamic import('...')
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

/** Walk dist and process .js files */
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.isFile() && p.endsWith('.js')) {
      const src = fs.readFileSync(p, 'utf8');
      const { changed, content } = processFile(src, p);
      if (changed) {
        fs.writeFileSync(p, content, 'utf8');
      }
    }
  }
}

if (fs.existsSync(DIST_DIR)) {
  walk(DIST_DIR);
} else {
  console.error('dist directory not found at', DIST_DIR);
  process.exitCode = 1;
}
