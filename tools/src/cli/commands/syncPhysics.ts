import fs from "node:fs";
import path from "node:path";
import { syncPhysicsToSubpackageUniModules } from "../../uniModules/syncPhysics.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdSyncPhysics(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const normalizedMode = args.get("mode");

  if (normalizedMode !== "subpackage-uni-modules") {
    throw new Error("sync-physics requires --mode subpackage-uni-modules");
  }

  const repoRoot = args.get("repoRoot")
    ? resolveMaybe(args.get("repoRoot"), process.cwd())
    : inferRepoRoot(process.cwd());

  const projectRoot = resolveMaybe(args.get("projectRoot") ?? args.get("appRoot"), process.cwd());
  const dest = args.get("dest");
  const subpackageRoot = args.get("subpackageRoot");
  const moduleName = args.get("moduleName");

  syncPhysicsToSubpackageUniModules({ repoRoot, projectRoot, dest, subpackageRoot, moduleName });
}

function resolveMaybe(p: string | undefined, base: string): string {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

function inferRepoRoot(cwd: string): string {
  const direct = cwd;
  if (fs.existsSync(path.join(direct, "physics-host-wechat"))) return direct;

  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "physics-host-wechat"))) return parent;

  return cwd;
}
