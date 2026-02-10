import fs from "node:fs";
import path from "node:path";
import { syncSceneryToConsumerUniModules, syncSceneryToViewerSubpackage } from "../../uniModules/syncScenery.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdSyncScenery(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const mode = args.get("mode");

  if (mode !== "viewer-subpackage" && mode !== "consumer-uni-modules") {
    throw new Error(`sync-scenery requires --mode viewer-subpackage|consumer-uni-modules`);
  }

  const repoRoot = args.get("repoRoot")
    ? resolveMaybe(args.get("repoRoot"), process.cwd())
    : inferRepoRoot(process.cwd());

  if (mode === "viewer-subpackage") {
    const projectRoot = resolveMaybe(args.get("projectRoot"), process.cwd());
    syncSceneryToViewerSubpackage({ repoRoot, viewerRoot: projectRoot });
    return;
  }

  // consumer-uni-modules
  const consumerRoot = args.get("consumerRoot")
    ? resolveMaybe(args.get("consumerRoot"), process.cwd())
    : undefined;

  syncSceneryToConsumerUniModules({ repoRoot, consumerRoot });
}

function resolveMaybe(p: string | undefined, base: string): string {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

function inferRepoRoot(cwd: string): string {
  const direct = cwd;
  if (fs.existsSync(path.join(direct, "scenery"))) return direct;

  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "scenery"))) return parent;

  return cwd;
}
