import path from "node:path";
import fs from "node:fs";
import { copyDirFiltered, ensureDir, rmrf, type ShouldCopy } from "../node/fsUtils.js";
import { toPosixPath } from "../node/pathUtils.js";

export type SyncPhysicsCommonOptions = {
  repoRoot: string;
};

export type SyncPhysicsToSubpackageUniModulesOptions = SyncPhysicsCommonOptions & {
  projectRoot: string;
  /** Defaults to 'pages/physics' */
  subpackageRoot?: string;
  /** Defaults to 'physics-mini' */
  moduleName?: string;
  /** Optional explicit destination path. If relative, resolved from projectRoot. */
  dest?: string;
};

const DEFAULT_ALLOWED_ROOTS = ["package.json", "src", "static"];

function defaultShouldCopyFactory(sourceRoot: string): ShouldCopy {
  return (relPosixPathFromRoot, entry, srcAbsPath) => {
    const rel = toPosixPath(relPosixPathFromRoot);

    if (!rel) return false;
    if (rel === "node_modules" || rel.startsWith("node_modules/")) return false;
    if (rel.startsWith(".git")) return false;
    if (rel === ".npmignore") return false;
    if (rel.endsWith(".log")) return false;
    if (rel === "package-lock.json" || rel === "pnpm-lock.yaml" || rel === "yarn.lock") return false;

    const first = rel.split("/")[0];
    if (!DEFAULT_ALLOWED_ROOTS.includes(first)) return false;

    if (entry.isDirectory()) {
      try {
        if (fs.readdirSync(srcAbsPath).length === 0) return false;
      } catch {
        // ignore
      }
    }

    void sourceRoot;
    return true;
  };
}

function physicsRootFromRepo(repoRoot: string): string {
  return path.resolve(repoRoot, "physics-bridge");
}

function resolveDestFromProjectRoot(projectRoot: string, dest: string): string {
  return path.isAbsolute(dest) ? dest : path.resolve(projectRoot, dest);
}

export function syncPhysicsToSubpackageUniModules(options: SyncPhysicsToSubpackageUniModulesOptions): void {
  const physicsRoot = physicsRootFromRepo(options.repoRoot);
  const subpackageRoot = options.subpackageRoot ?? "pages/physics";
  const moduleName = options.moduleName ?? "physics-mini";

  const dest = options.dest
    ? resolveDestFromProjectRoot(options.projectRoot, options.dest)
    : path.resolve(options.projectRoot, `src/${subpackageRoot}/uni_modules/${moduleName}`);

  if (!fs.existsSync(physicsRoot)) {
    throw new Error(`physics-bridge root not found: ${physicsRoot}`);
  }

  rmrf(dest);
  ensureDir(dest);

  const shouldCopy = defaultShouldCopyFactory(physicsRoot);
  copyDirFiltered(physicsRoot, physicsRoot, dest, (rel, entry, srcAbsPath) => {
    return shouldCopy(toPosixPath(rel), entry, srcAbsPath);
  });

  console.log(`[harmony-tools] synced physics-bridge -> ${dest}`);
}
