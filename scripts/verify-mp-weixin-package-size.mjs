import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const SPARK_IDENTIFIERS = [
  'PagedSplats',
  'SplatMesh',
  'SplatFileType',
];

const appRoot = resolve(process.cwd(), process.argv[2] ?? '.');
const outputRoot = join(appRoot, 'dist', 'build', 'mp-weixin');
const appJsonPath = join(outputRoot, 'app.json');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function collectFiles(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function packageKeyFor(relativePath, subPackageRoots) {
  const normalized = relativePath.replaceAll('\\', '/');
  for (const root of subPackageRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      return root;
    }
  }
  return '__main__';
}

let appJson;
try {
  appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
} catch (error) {
  console.error(`[package-size] cannot read ${appJsonPath}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const subPackageEntries = appJson.subPackages ?? appJson.subpackages ?? [];
const subPackageRoots = subPackageEntries
  .map((entry) => String(entry.root ?? '').replace(/\\/g, '/').replace(/^\/|\/$/g, ''))
  .filter(Boolean);

if (!subPackageRoots.includes('pages/spark')) {
  console.warn('[package-size] pages/spark subpackage is not declared');
}

const packageSizes = new Map();
const mainJsFiles = [];

for (const filePath of collectFiles(outputRoot)) {
  const relativePath = relative(outputRoot, filePath);
  const key = packageKeyFor(relativePath, subPackageRoots);
  const size = statSync(filePath).size;
  packageSizes.set(key, (packageSizes.get(key) ?? 0) + size);

  if (key === '__main__' && /\.(js|mjs|cjs)$/i.test(filePath)) {
    mainJsFiles.push(filePath);
  }
}

let failed = false;

for (const [key, size] of [...packageSizes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const label = key === '__main__' ? 'main' : `subpackage:${key}`;
  const kib = (size / 1024).toFixed(1);
  const over = size > MAX_PACKAGE_BYTES;
  console.log(`[package-size] ${label} = ${kib} KiB (${size} bytes)${over ? ' OVER LIMIT' : ''}`);
  if (over) {
    failed = true;
  }
}

for (const filePath of mainJsFiles) {
  const code = readFileSync(filePath, 'utf8');
  // Match whole identifiers only: `maxPagedSplats` (a plain tuning field) contains
  // the substring `PagedSplats` but has nothing to do with the Spark library.
  const hit = SPARK_IDENTIFIERS.find((identifier) =>
    new RegExp(`(^|[^A-Za-z0-9_$])${identifier}([^A-Za-z0-9_$]|$)`).test(code),
  );
  if (hit) {
    const relativePath = relative(outputRoot, filePath).replaceAll('\\', '/');
    fail(`[package-size] Spark identifier "${hit}" found in main package file: ${relativePath}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('[package-size] all packages are within 2 MiB and Spark is not in the main package');
