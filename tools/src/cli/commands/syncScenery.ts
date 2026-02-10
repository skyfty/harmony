import fs from "node:fs";
import path from "node:path";
import {
  syncSceneryToConsumerUniModules,
  syncSceneryToSubpackageUniModules,
  syncSceneryToViewerSubpackage,
} from "../../uniModules/syncScenery.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdSyncScenery(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const normalizedMode = args.get("mode");


  if (normalizedMode !== "subpackage-uni-modules" && normalizedMode !== "consumer-uni-modules") {
    throw new Error(
      `sync-scenery requires --mode subpackage-uni-modules|consumer-uni-modules (viewer-subpackage is supported as an alias)`
    );
  }

  const repoRoot = args.get("repoRoot")
    ? resolveMaybe(args.get("repoRoot"), process.cwd())
    : inferRepoRoot(process.cwd());

  if (normalizedMode === "subpackage-uni-modules") {
    const projectRoot = resolveMaybe(args.get("projectRoot") ?? args.get("appRoot"), process.cwd());
    const dest = args.get("dest");
    const subpackageRoot = args.get("subpackageRoot");
    const moduleName = args.get("moduleName");

    // Prefer the generic implementation; keep the old function for compatibility.
    if (dest || subpackageRoot || moduleName) {
      syncSceneryToSubpackageUniModules({ repoRoot, projectRoot, dest, subpackageRoot, moduleName });
    } else {
      syncSceneryToViewerSubpackage({ repoRoot, viewerRoot: projectRoot });
    }
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
