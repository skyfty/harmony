import { unzipSync } from 'fflate';
import { inferMimeTypeFromAssetId } from './assetTypeConversion';
import type { ScenePackageManifest } from './scenePackage';
import { isScenePackageManifest } from './scenePackage';

export type ScenePackageUnzipped = {
  manifest: ScenePackageManifest;
  /** Raw zip entries keyed by their internal path. */
  files: Record<string, Uint8Array>;
};

export type AssetOverrideBytes = {
  bytes: ArrayBuffer | Uint8Array;
  mimeType?: string | null;
  filename?: string | null;
};

export type AssetOverrideValue = string | ArrayBuffer | AssetOverrideBytes;

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  // Fallback: best-effort ASCII.
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

export function unzipScenePackage(zip: ArrayBuffer | Uint8Array): ScenePackageUnzipped {
  const files = unzipSync(toUint8Array(zip));
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Scene package missing manifest.json');
  }
  const manifestRaw = JSON.parse(decodeUtf8(manifestBytes)) as unknown;
  if (!isScenePackageManifest(manifestRaw)) {
    throw new Error('Invalid scene package manifest');
  }
  return {
    manifest: manifestRaw,
    files,
  };
}

export function buildAssetOverridesFromScenePackage(pkg: ScenePackageUnzipped): Record<string, AssetOverrideValue> {
  const overrides: Record<string, AssetOverrideValue> = {};
  for (const entry of pkg.manifest.resources) {
    const bytes = pkg.files[entry.path];
    if (!bytes) {
      throw new Error(`Missing resource file in scene package: ${entry.path}`);
    }
    const filename = `${entry.logicalId}.${entry.ext}`;
    const mimeType = entry.mimeType || inferMimeTypeFromAssetId(filename) || 'application/octet-stream';
    overrides[entry.logicalId] = {
      bytes,
      mimeType,
      filename,
    };
  }
  return overrides;
}

export function readTextFileFromScenePackage(pkg: ScenePackageUnzipped, path: string): string {
  const bytes = pkg.files[path];
  if (!bytes) {
    throw new Error(`Missing file in scene package: ${path}`);
  }
  return decodeUtf8(bytes);
}
