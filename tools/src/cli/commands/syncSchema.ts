import fs from "node:fs";
import path from "node:path";
import { syncSchemaToViewerSubpackage } from "../../uniModules/syncScenery.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdSyncSchema(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = args.get("repoRoot")
    ? resolveMaybe(args.get("repoRoot"), process.cwd())
    : inferRepoRoot(process.cwd());
  const viewerRoot = args.get("viewerRoot")
    ? resolveMaybe(args.get("viewerRoot"), process.cwd())
    : process.cwd();

  syncSchemaToViewerSubpackage({
    repoRoot,
    viewerRoot,
  });
}

function resolveMaybe(p: string | undefined, base: string): string {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

function inferRepoRoot(cwd: string): string {
  const direct = cwd;
  if (pathExists(path.join(direct, "schema"))) {
    return direct;
  }

  const parent = path.resolve(cwd, "..");
  if (pathExists(path.join(parent, "schema"))) {
    return parent;
  }

  return cwd;
}

function pathExists(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}
