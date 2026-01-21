export const SCENE_PACKAGE_FORMAT = 'harmony-scene-package' as const;
export const SCENE_PACKAGE_VERSION = 1 as const;

export type ScenePackageResourceType =
  | 'terrainWeightmap'
  | 'lightmap'
  | 'navmesh'
  | 'baked'
  | 'other';

export interface ScenePackageSceneEntry {
  sceneId: string;
  /** Path within ZIP, e.g. `scenes/<sceneId>/scene.json` */
  path: string;
}

export interface ScenePackageProjectEntry {
  /** Path within ZIP, e.g. `project/project.json` */
  path: string;
}

export interface ScenePackageResourceEntry {
  logicalId: string;
  resourceType: ScenePackageResourceType;
  /** Path within ZIP, e.g. `resources/terrainWeightmap/<logicalId>.png` */
  path: string;
  /** File extension without dot, e.g. `png` */
  ext: string;
  /** MIME type, e.g. `image/png` */
  mimeType: string;
  /** Byte size (optional but recommended). */
  size?: number;
  /** Content hash (optional). If using sha256 logicalId, can be omitted. */
  hash?: string;
}

export interface ScenePackageManifestV1 {
  format: typeof SCENE_PACKAGE_FORMAT;
  version: typeof SCENE_PACKAGE_VERSION;
  createdAt?: string;

  project: ScenePackageProjectEntry;
  scenes: ScenePackageSceneEntry[];
  resources: ScenePackageResourceEntry[];
}

export type ScenePackageManifest = ScenePackageManifestV1;

export function isScenePackageManifest(raw: unknown): raw is ScenePackageManifestV1 {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<ScenePackageManifestV1>;
  if (candidate.format !== SCENE_PACKAGE_FORMAT) return false;
  if (candidate.version !== SCENE_PACKAGE_VERSION) return false;
  if (!candidate.project || typeof candidate.project !== 'object') return false;
  if (typeof (candidate.project as any).path !== 'string') return false;
  if (!Array.isArray(candidate.scenes)) return false;
  if (!Array.isArray(candidate.resources)) return false;
  return true;
}
