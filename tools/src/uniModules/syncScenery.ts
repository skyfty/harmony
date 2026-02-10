import path from "node:path";
import fs from "node:fs";
import { copyDirFiltered, ensureDir, rmrf, type ShouldCopy } from "../node/fsUtils.js";
import { toPosixPath } from "../node/pathUtils.js";

export type SyncSceneryCommonOptions = {
  repoRoot: string;
};

export type SyncSceneryToSubpackageUniModulesOptions = SyncSceneryCommonOptions & {
  projectRoot: string;
  /** Defaults to 'pages/scenery' */
  subpackageRoot?: string;
  /** Defaults to 'scenery' */
  moduleName?: string;
  /** Optional explicit destination path. If relative, resolved from projectRoot. */
  dest?: string;
};

export type SyncSceneryToViewerSubpackageOptions = SyncSceneryCommonOptions & {
  viewerRoot: string;
};

export type SyncSceneryToConsumerUniModulesOptions = SyncSceneryCommonOptions & {
  consumerRoot?: string;
};

const DEFAULT_ALLOWED_ROOTS = ["package.json", "components", "common", "static"];

const DEFAULT_EXCLUDES = [
  "scripts/",
  "node_modules/",
  ".npmignore",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
];

function defaultShouldCopyFactory(sourceRoot: string): ShouldCopy {
  return (relPosixPathFromRoot, entry, srcAbsPath) => {
    const rel = toPosixPath(relPosixPathFromRoot);

    if (!rel) return false;

    // Keep uni_modules clean: do not copy installer scripts into app source.
    if (rel === "scripts" || rel.startsWith("scripts/")) return false;
    if (rel === "node_modules" || rel.startsWith("node_modules/")) return false;
    if (rel.startsWith(".git")) return false;
    if (rel === ".npmignore") return false;
    if (rel.endsWith(".log")) return false;
    if (rel === "package-lock.json" || rel === "pnpm-lock.yaml" || rel === "yarn.lock") return false;

    // Only include directories/files we expect under a uni_modules module.
    const allowedRoots = DEFAULT_ALLOWED_ROOTS;
    const first = rel.split("/")[0];
    if (!allowedRoots.includes(first)) return false;

    // Skip empty directories only created for scripts, etc.
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

function sceneryRootFromRepo(repoRoot: string): string {
  return path.resolve(repoRoot, "scenery");
}

function resolveDestFromProjectRoot(projectRoot: string, dest: string): string {
  return path.isAbsolute(dest) ? dest : path.resolve(projectRoot, dest);
}

export function syncSceneryToSubpackageUniModules(options: SyncSceneryToSubpackageUniModulesOptions): void {
  const sceneryRoot = sceneryRootFromRepo(options.repoRoot);

  const subpackageRoot = options.subpackageRoot ?? "pages/scenery";
  const moduleName = options.moduleName ?? "scenery";

  const dest = options.dest
    ? resolveDestFromProjectRoot(options.projectRoot, options.dest)
    : path.resolve(options.projectRoot, `src/${subpackageRoot}/uni_modules/${moduleName}`);

  if (!fs.existsSync(sceneryRoot)) {
    throw new Error(`scenery root not found: ${sceneryRoot}`);
  }

  rmrf(dest);
  ensureDir(dest);

  const shouldCopy = defaultShouldCopyFactory(sceneryRoot);

  copyDirFiltered(sceneryRoot, sceneryRoot, dest, (rel, entry, srcAbsPath) => {
    return shouldCopy(toPosixPath(rel), entry, srcAbsPath);
  });

  console.log(`[harmony-tools] synced scenery -> ${dest}`);
}

export function syncSceneryToViewerSubpackage(options: SyncSceneryToViewerSubpackageOptions): void {
  // Back-compat wrapper: historically hard-coded to pages/scenery/uni_modules/scenery under viewerRoot.
  syncSceneryToSubpackageUniModules({
    repoRoot: options.repoRoot,
    projectRoot: options.viewerRoot,
    subpackageRoot: "pages/scenery",
    moduleName: "scenery",
  });
}

export function syncSceneryToConsumerUniModules(options: SyncSceneryToConsumerUniModulesOptions): void {
  const sceneryRoot = sceneryRootFromRepo(options.repoRoot);
  const consumerRoot = options.consumerRoot ?? resolveConsumerRoot();
  const dest = path.resolve(consumerRoot, "src/uni_modules/scenery");

  if (!fs.existsSync(sceneryRoot)) {
    throw new Error(`scenery root not found: ${sceneryRoot}`);
  }

  rmrf(dest);
  ensureDir(dest);

  const shouldCopy = defaultShouldCopyFactory(sceneryRoot);
  copyDirFiltered(sceneryRoot, sceneryRoot, dest, (rel, entry, srcAbsPath) => {
    return shouldCopy(toPosixPath(rel), entry, srcAbsPath);
  });

  console.log(`[harmony-tools] synced scenery -> ${dest}`);
}

export function resolveConsumerRoot(): string {
  // npm sets INIT_CWD to the directory where the install was initiated.
  const initCwd = process.env.INIT_CWD;
  if (initCwd && path.isAbsolute(initCwd)) return initCwd;

  // When invoked manually from an app, prefer cwd.
  const cwd = process.cwd();
  if (cwd && path.isAbsolute(cwd)) return cwd;

  // Fallback: best-effort guess.
  return path.resolve(process.cwd(), "..", "..", "..");
}
