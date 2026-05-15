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
  /** When true, create a directory link to the source instead of copying files. */
  linkInsteadOfCopy?: boolean;
};

export type SyncSceneryToViewerSubpackageOptions = SyncSceneryCommonOptions & {
  viewerRoot: string;
  linkInsteadOfCopy?: boolean;
};

export type SyncSchemaToViewerSubpackageOptions = SyncSceneryCommonOptions & {
  viewerRoot: string;
};

export type SyncSceneryDependencyMirrorsOptions = SyncSceneryCommonOptions & {
  viewerRoot: string;
};

export type SyncSceneryToConsumerUniModulesOptions = SyncSceneryCommonOptions & {
  consumerRoot?: string;
};

const DEFAULT_ALLOWED_ROOTS = ["package.json", "components", "common", "composables", "static"];

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

function replaceDirectoryLink(sourceDir: string, targetDir: string): void {
  rmrf(targetDir);
  ensureDir(path.dirname(targetDir));
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(sourceDir, targetDir, linkType);
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

  if (options.linkInsteadOfCopy) {
    replaceDirectoryLink(sceneryRoot, dest);
    console.log(`[harmony-tools] linked scenery -> ${dest}`);
    return;
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
    linkInsteadOfCopy: options.linkInsteadOfCopy,
  });
}

export function syncSchemaToViewerSubpackage(options: SyncSchemaToViewerSubpackageOptions): void {
  const schemaRoot = path.resolve(options.repoRoot, "schema");
  const schemaMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/schema");

  if (!fs.existsSync(schemaRoot)) {
    throw new Error(`schema root not found: ${schemaRoot}`);
  }

  replaceDirectoryLink(schemaRoot, schemaMirrorDir);
  console.log(`[harmony-tools] synced schema mirror -> ${schemaMirrorDir}`);
}

export function syncSceneryDependencyMirrors(options: SyncSceneryDependencyMirrorsOptions): void {
  const physicsCoreRoot = path.resolve(options.repoRoot, "physics-core", "src");
  const utilsRoot = path.resolve(options.repoRoot, "utils", "src");
  const physicsBridgeRoot = path.resolve(options.repoRoot, "physics-bridge", "src");
  const threeRoot = path.resolve(options.viewerRoot, "node_modules", "three");
  const meshBvhRoot = path.resolve(options.viewerRoot, "node_modules", "three-mesh-bvh");
  const threeAdapterOverrideRoot = path.resolve(
    options.viewerRoot,
    "node_modules",
    "@minisheep",
    "three-platform-adapter",
    "dist",
    "three-override",
    "jsm",
  );
  const cannonRoot = path.resolve(options.viewerRoot, "node_modules", "cannon-es");
  const ammoRoot = path.resolve(options.viewerRoot, "node_modules", "ammojs3");
  const physicsCoreMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/physics-core");
  const utilsMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/utils");
  const physicsBridgeMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/physics-bridge");
  const threeMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/three");
  const meshBvhMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/three-mesh-bvh");
  const threeAdapterOverrideMirrorDir = path.resolve(options.viewerRoot, "src/pages/scenery/three-platform-adapter/override/jsm");
  const cannonMirrorDir = path.resolve(options.viewerRoot, "src/pages/physics-cannon/cannon-es");
  const ammoMirrorDir = path.resolve(options.viewerRoot, "src/pages/physics-ammo/ammojs3");

  if (!fs.existsSync(physicsCoreRoot)) {
    throw new Error(`physics-core root not found: ${physicsCoreRoot}`);
  }

  if (!fs.existsSync(utilsRoot)) {
    throw new Error(`utils root not found: ${utilsRoot}`);
  }

  if (!fs.existsSync(threeRoot)) {
    throw new Error(`three root not found: ${threeRoot}`);
  }

  if (!fs.existsSync(meshBvhRoot)) {
    throw new Error(`three-mesh-bvh root not found: ${meshBvhRoot}`);
  }

  if (!fs.existsSync(threeAdapterOverrideRoot)) {
    throw new Error(`three-platform-adapter override root not found: ${threeAdapterOverrideRoot}`);
  }

  if (!fs.existsSync(physicsBridgeRoot)) {
    throw new Error(`physics-bridge root not found: ${physicsBridgeRoot}`);
  }

  if (!fs.existsSync(cannonRoot)) {
    throw new Error(`cannon-es root not found: ${cannonRoot}`);
  }

  if (!fs.existsSync(ammoRoot)) {
    throw new Error(`ammojs3 root not found: ${ammoRoot}`);
  }

  replaceDirectoryLink(physicsCoreRoot, physicsCoreMirrorDir);
  replaceDirectoryLink(utilsRoot, utilsMirrorDir);
  replaceDirectoryLink(physicsBridgeRoot, physicsBridgeMirrorDir);
  replaceDirectoryLink(threeRoot, threeMirrorDir);
  replaceDirectoryLink(meshBvhRoot, meshBvhMirrorDir);
  replaceDirectoryLink(threeAdapterOverrideRoot, threeAdapterOverrideMirrorDir);
  replaceDirectoryLink(cannonRoot, cannonMirrorDir);
  replaceDirectoryLink(ammoRoot, ammoMirrorDir);

  console.log(
    `[harmony-tools] synced scenery dependency mirrors -> ${physicsCoreMirrorDir}, ${utilsMirrorDir}, ${physicsBridgeMirrorDir}, ${threeMirrorDir}, ${meshBvhMirrorDir}, ${threeAdapterOverrideMirrorDir}, ${cannonMirrorDir}, ${ammoMirrorDir}`,
  );
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
  // Package managers set INIT_CWD to the directory where the install was initiated.
  const initCwd = process.env.INIT_CWD;
  if (initCwd && path.isAbsolute(initCwd)) return initCwd;

  // When invoked manually from an app, prefer cwd.
  const cwd = process.cwd();
  if (cwd && path.isAbsolute(cwd)) return cwd;

  // Fallback: best-effort guess.
  return path.resolve(process.cwd(), "..", "..", "..");
}
