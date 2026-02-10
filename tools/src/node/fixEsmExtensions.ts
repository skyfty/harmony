import fs from "node:fs";
import path from "node:path";

export type FixEsmExtensionsOptions = {
  rootDir: string;
  skipNodeModules?: boolean;
};

const KNOWN_EXT_RE = /\.(mjs|cjs|js|json|node)$/i;

function hasKnownExt(p: string): boolean {
  return KNOWN_EXT_RE.test(p);
}

function rewriteSpecifier(filePath: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (hasKnownExt(specifier)) return null;

  const baseDir = path.dirname(filePath);
  const abs = path.resolve(baseDir, specifier);

  const fileJs = abs + ".js";
  const fileJson = abs + ".json";
  const fileNode = abs + ".node";
  const dirIndex = path.join(abs, "index.js");

  if (fs.existsSync(fileJs)) return specifier + ".js";
  if (fs.existsSync(fileJson)) return specifier + ".json";
  if (fs.existsSync(fileNode)) return specifier + ".node";

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(dirIndex)) {
    return specifier.endsWith("/") ? specifier + "index.js" : specifier + "/index.js";
  }

  return null;
}

function processFile(content: string, filePath: string): { changed: boolean; content: string } {
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

function walk(dir: string, options: FixEsmExtensionsOptions): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (options.skipNodeModules && entry.name === "node_modules") continue;
      walk(p, options);
      continue;
    }

    if (entry.isFile() && p.endsWith(".js")) {
      const src = fs.readFileSync(p, "utf8");
      const { changed, content } = processFile(src, p);
      if (changed) {
        fs.writeFileSync(p, content, "utf8");
      }
    }
  }
}

export function fixEsmExtensions(options: FixEsmExtensionsOptions): void {
  if (!fs.existsSync(options.rootDir)) {
    throw new Error(`Directory not found: ${options.rootDir}`);
  }
  walk(options.rootDir, options);
}
