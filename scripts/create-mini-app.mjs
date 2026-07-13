import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(repoRoot, 'templates', 'mini-app');

const args = parseArgs(process.argv.slice(2));
const appName = args.name;
const appKey = args.appKey;
const appType = args.appType;
const targetDir = resolve(process.cwd(), args.target ?? appName);

if (!appName || !appKey || !appType) {
  printHelp();
  process.exit(1);
}

if (appType !== 'tour' && appType !== 'viewer') {
  throw new Error('app-type must be either tour or viewer');
}

const packagesRelativePath = relative(targetDir, join(repoRoot, 'packages')).replaceAll('\\', '/');
const replacements = {
  '__APP_NAME__': appName,
  '__APP_KEY__': appKey,
  '__APP_TYPE__': appType,
  '__APP_TITLE__': toTitle(appName),
  '__PACKAGES_RELATIVE__': packagesRelativePath,
};

await ensureTemplateExists();
await ensureTargetDir(targetDir, args.force);
await copyTemplate(templateRoot, targetDir, replacements);

console.log(`Created mini app scaffold at ${targetDir}`);

async function ensureTemplateExists() {
  try {
    await stat(templateRoot);
  } catch {
    throw new Error(`Template directory not found: ${templateRoot}`);
  }
}

async function ensureTargetDir(dir, force) {
  try {
    const existing = await stat(dir);
    if (!existing.isDirectory()) {
      throw new Error(`${dir} already exists and is not a directory`);
    }
    const items = await readdir(dir);
    if (items.length > 0) {
      if (!force) {
        throw new Error(`${dir} already exists and is not empty. Pass --force to overwrite.`);
      }
      await rm(dir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    if (force) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

async function copyTemplate(sourceDir, targetBaseDir, replacementsMap) {
  await mkdir(targetBaseDir, { recursive: true });
  await copyTree(sourceDir, targetBaseDir, replacementsMap);
}

async function copyTree(sourceDir, targetDir, replacementsMap) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTree(sourcePath, targetPath, replacementsMap);
      continue;
    }
    const raw = await readFile(sourcePath, 'utf8');
    const rendered = renderTemplate(raw, replacementsMap);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, rendered, 'utf8');
  }
}

function renderTemplate(content, replacementsMap) {
  let output = content;
  for (const [needle, value] of Object.entries(replacementsMap)) {
    output = output.split(needle).join(value);
  }
  return output;
}

function toTitle(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--name') {
      result.name = argv[++index];
      continue;
    }
    if (token === '--app-key') {
      result.appKey = argv[++index];
      continue;
    }
    if (token === '--app-type') {
      result.appType = argv[++index];
      continue;
    }
    if (token === '--target') {
      result.target = argv[++index];
      continue;
    }
    if (token === '--force') {
      result.force = true;
    }
  }
  return result;
}

function printHelp() {
  console.log(`
Mini app scaffold generator

Usage:
  node scripts/create-mini-app.mjs --name <app-name> --app-key <app-key> --app-type <tour|viewer> [--target <dir>] [--force]

Examples:
  node scripts/create-mini-app.mjs --name tour-lake --app-key tour-lake --app-type tour --target .\\apps\\tour-lake
  node scripts/create-mini-app.mjs --name viewer-kiosk --app-key viewer-kiosk --app-type viewer --target .\\apps\\viewer-kiosk
`);
}
