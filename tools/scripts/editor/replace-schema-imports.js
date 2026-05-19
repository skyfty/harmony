import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..', '..');
const defaultRoot = resolve(repoRoot, 'editor', 'src');
const root = resolve(process.cwd(), getArgValue('--root') ?? defaultRoot);
const exts = new Set(['.ts', '.tsx', '.vue', '.js']);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!exts.has(full.slice(full.lastIndexOf('.')))) continue;
    const text = readFileSync(full, 'utf8');
    const replaced = text.replace(/@schema(\/|\b)/g, '@harmony/schema$1');
    if (replaced !== text) {
      writeFileSync(full, replaced, 'utf8');
      console.log('Updated', relative(root, full));
    }
  }
}

walk(root);
console.log('Done');
