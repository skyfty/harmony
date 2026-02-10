import fs from "node:fs";
import path from "node:path";
import { toPosixPath } from "./pathUtils.js";

export function rmrf(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function writeJsonPretty(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

export type ShouldCopy = (
  relPosixPathFromRoot: string,
  entry: fs.Dirent,
  srcAbsPath: string,
) => boolean;

export function copyDirFiltered(
  srcRootDir: string,
  srcDir: string,
  destDir: string,
  shouldCopy: ShouldCopy,
): void {
  ensureDir(destDir);

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    const rel = toPosixPath(path.relative(srcRootDir, srcPath));
    if (!shouldCopy(rel, entry, srcPath)) continue;

    if (entry.isDirectory()) {
      copyDirFiltered(srcRootDir, srcPath, destPath, shouldCopy);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function walkFiles(rootDir: string, predicate: (absPath: string) => boolean): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(absPath, predicate));
    } else if (entry.isFile()) {
      if (predicate(absPath)) out.push(absPath);
    }
  }

  return out;
}
