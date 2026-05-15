import fs from "node:fs";
import path from "node:path";

export type SyncPhysicsOptions = {
  repoRoot: string;
  viewerRoot: string;
};

export function syncPhysicsToViewerSubpackage(options: SyncPhysicsOptions): void {
  const physicsAmmoSourceDir = path.resolve(options.repoRoot, "physics-ammo/src");
  const physicsCannonSourceDir = path.resolve(options.repoRoot, "physics-cannon/src");
  const physicsAmmoMirrorDir = path.resolve(options.viewerRoot, "src/pages/physics-ammo/engine");
  const physicsCannonMirrorDir = path.resolve(options.viewerRoot, "src/pages/physics-cannon/engine");
  const physicsAmmoVendorDir = path.resolve(options.viewerRoot, "src/pages/physics-ammo/vendor");
  const ammoBootstrapSourceFile = path.resolve(options.viewerRoot, "node_modules/ammojs3/dist/ammo.wasm.js");
  const ammoWasmSourceFile = path.resolve(options.viewerRoot, "node_modules/ammojs3/dist/ammo.wasm.wasm");

  replaceDirectoryLink(physicsAmmoSourceDir, physicsAmmoMirrorDir);
  replaceDirectoryLink(physicsCannonSourceDir, physicsCannonMirrorDir);
  replaceDirectoryWithFiles(physicsAmmoVendorDir, [
    [ammoBootstrapSourceFile, "ammo.wasm.js"],
    [ammoWasmSourceFile, "ammo.wasm.wasm"],
  ]);
}

function replaceDirectoryLink(sourceDir: string, targetDir: string): void {
  removePath(targetDir);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(sourceDir, targetDir, linkType);
}

function replaceDirectoryWithFiles(targetDir: string, filePairs: Array<[string, string]>): void {
  removePath(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [sourceFile, targetFileName] of filePairs) {
    fs.copyFileSync(sourceFile, path.resolve(targetDir, targetFileName));
  }
}

function removePath(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}
