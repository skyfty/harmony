export const SCENE_PACKAGE_FORMAT = 'harmony-scene-package' as const;
export const SCENE_PACKAGE_VERSION = 9 as const;

export interface ScenePackageTerrainEntry {
  datasetId: string;
  /** Path within ZIP, e.g. `scenes/<sceneId>/terrain/root.json` */
  rootManifestPath: string;
  /** Region pack directory within ZIP, e.g. `scenes/<sceneId>/terrain/regions/` */
  regionsPath?: string;
}

export type ScenePackageResourceType =
  | 'localAsset'
  | 'planningImage'
  | 'terrainWeightmap'
  | 'lightmap'
  | 'navmesh'
  | 'baked'
  | 'other';

export interface ScenePackageSceneEntry {
  sceneId: string;
  /** Path within ZIP, e.g. `scenes/<sceneId>/scene.bin` */
  path: string;
  /** Optional editor-only planning sidecar path, e.g. `scenes/<sceneId>/planning.json` */
  planningPath?: string;
  /** Optional ground scatter sidecar path, e.g. `scenes/<sceneId>/ground-scatter.bin` */
  groundScatterPath?: string;
  /** Optional ground paint sidecar path, e.g. `scenes/<sceneId>/ground-paint.bin` */
  groundPaintPath?: string;
  /** Readonly runtime terrain package entry used by preview/mobile viewers. */
  terrain?: ScenePackageTerrainEntry;
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
