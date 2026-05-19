import path from "node:path";
import fs from "node:fs";
import { parseArgs } from "../parseArgs.js";
import { syncSceneryDependencyMirrors } from "../../uniModules/syncScenery.js";

export async function cmdSyncSceneryMirrors(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = process.cwd();
  const repoRoot = resolveMaybe(args.get("repoRoot"), inferRepoRoot(cwd));
  const viewerRoot = resolveMaybe(args.get("viewerRoot"), inferViewerRoot(cwd));

  syncSceneryDependencyMirrors({
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
  if (fs.existsSync(path.join(direct, "physics-core")) && fs.existsSync(path.join(direct, "utils"))) {
    return direct;
  }

  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "physics-core")) && fs.existsSync(path.join(parent, "utils"))) {
    return parent;
  }

  return cwd;
}

function inferViewerRoot(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "src/pages/scenery"))) {
    return cwd;
  }

  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "src/pages/scenery"))) {
    return parent;
  }

  return cwd;
}
