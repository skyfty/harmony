import path from "node:path";
import { parseArgs } from "../parseArgs.js";
import { syncSceneryDependencyMirrors } from "../../uniModules/syncScenery.js";

export async function cmdSyncSceneryMirrors(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = resolveMaybe(args.get("repoRoot"), process.cwd());
  const viewerRoot = resolveMaybe(args.get("viewerRoot"), process.cwd());

  syncSceneryDependencyMirrors({
    repoRoot,
    viewerRoot,
  });
}

function resolveMaybe(p: string | undefined, base: string): string {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}
