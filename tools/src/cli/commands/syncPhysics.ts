import path from "node:path";
import { syncPhysicsToViewerSubpackage } from "../../uniModules/syncPhysics.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdSyncPhysics(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repoRoot = resolveMaybe(args.get("repoRoot") ?? args.get("root"), inferRepoRoot(process.cwd()));
  const viewerRoot = resolveMaybe(args.get("viewerRoot") ?? args.get("projectRoot"), inferViewerRoot(process.cwd()));

  syncPhysicsToViewerSubpackage({
    repoRoot,
    viewerRoot,
  });

  console.log(`[harmony-tools] synced physics mirrors -> ${path.resolve(viewerRoot, "src/pages/physics-ammo/engine")} and ${path.resolve(viewerRoot, "src/pages/physics-cannon/engine")}`);
}

function resolveMaybe(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function inferRepoRoot(cwd: string): string {
  const direct = cwd;
  if (pathExists(path.join(direct, "physics-ammo")) && pathExists(path.join(direct, "physics-cannon"))) {
    return direct;
  }

  const parent = path.resolve(cwd, "..");
  if (pathExists(path.join(parent, "physics-ammo")) && pathExists(path.join(parent, "physics-cannon"))) {
    return parent;
  }

  return cwd;
}

function inferViewerRoot(cwd: string): string {
  if (pathExists(path.join(cwd, "src/pages/scenery"))) {
    return cwd;
  }

  const parent = path.resolve(cwd, "..");
  if (pathExists(path.join(parent, "src/pages/scenery"))) {
    return parent;
  }

  return cwd;
}

function pathExists(targetPath: string): boolean {
  try {
    return require("node:fs").existsSync(targetPath);
  } catch {
    return false;
  }
}
