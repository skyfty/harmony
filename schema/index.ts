
import * as THREE from 'three'
import type { SceneNodeInstanceLayout } from './instanceLayout'
import type { TerrainScatterStoreSnapshot } from './terrain-scatter'
import type { AssetBundleHashAlgorithm } from './asset-api'
import type { AssetType } from './asset-types'
import { createUvDebugMaterial } from './debugTextures'

export const GROUND_NODE_ID = 'harmony:ground'
export const ENVIRONMENT_NODE_ID = 'harmony:environment'
export const MULTIUSER_NODE_ID = 'harmony:multiuser'
export const PROTAGONIST_NODE_ID = 'harmony:protagonist'

export { AssetCache, AssetLoader } from './assetCache'
export type { AssetCacheEntry, AssetCacheStatus, AssetSource, AssetLoadOptions, AssetLoadPersistenceOptions } from './assetCache'
export {
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  createWeChatFileSystemPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  isWeChatFileSystemPersistentAssetStorageSupported,
  normalizePersistentAssetKey,
  resolvePersistentAssetKeys,
} from './persistentAssetStorage'
export type {
  IndexedDbPersistentAssetStorageOptions,
  PersistentAssetKeyInput,
  PersistentAssetRecord,
  PersistentAssetStorage,
  PersistentAssetWritePayload,
  WeChatFileSystemPersistentAssetStorageOptions,
} from './persistentAssetStorage'

export {
  SKY_CUBE_FACE_KEYS,
  SKY_CUBE_FACE_ORDER,
  SKY_CUBE_FACE_LABELS,
  normalizeSkyCubeUrls,
  loadSkyCubeTexture,
  disposeSkyCubeTexture,
  extractSkycubeZipFaces,
} from './skyCubeTexture'

export {
  DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
  DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  DEFAULT_ENVIRONMENT_FOG_COLOR,
  DEFAULT_ENVIRONMENT_FOG_DENSITY,
  DEFAULT_ENVIRONMENT_FOG_NEAR,
  DEFAULT_ENVIRONMENT_FOG_FAR,
  DEFAULT_ENVIRONMENT_FOG_AUTO_FIT_TO_GROUND,
  DEFAULT_ENVIRONMENT_PHYSICS_ENABLED,
  DEFAULT_ENVIRONMENT_GRAVITY,
  DEFAULT_ENVIRONMENT_RESTITUTION,
  DEFAULT_ENVIRONMENT_FRICTION,
  DEFAULT_ENVIRONMENT_ORIENTATION_PRESET,
  DEFAULT_ENVIRONMENT_ROTATION_DEGREES,
  DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
  DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
  DEFAULT_ENVIRONMENT_SETTINGS,
  cloneEnvironmentSettings,
  extractEnvironmentSettingsFromNodes,
  resolveAdaptiveLinearFogRange,
  resolveDocumentEnvironment,
} from './environmentSettingsUtils'
export type { AdaptiveLinearFogRange } from './environmentSettingsUtils'
export type {
  SkyCubeFaceKey,
  SkyCubeTextureLoadOptions,
  SkyCubeTextureLoadResult,
  SkycubeZipFaceBytes,
  ExtractSkycubeZipFacesResult,
} from './skyCubeTexture'

export { computePlaySoundDistanceGain, resolvePlaySoundSourcePoint } from './soundDistance'

export { disposeSignboardBillboards, syncSignboardBillboards } from './signboardBillboardRuntime'

export { getDefaultUvDebugTexture, createUvDebugMaterial } from './debugTextures'

export {
  TerrainScatterCategories,
  appendTerrainScatterInstances,
  removeTerrainScatterInstancesById,
} from './terrain-scatter'
export type { TerrainScatterCategory } from './terrain-scatter'
export type {
  AssetCategory,
  AssetHashLookupEntry,
  AssetHashLookupMatch,
  AssetHashLookupResponse,
  AssetBundleFileEntry,
  AssetBundleFileRole,
  AssetBundleHashAlgorithm,
  AssetBundleManifest,
  AssetBundlePersistedRole,
  AssetPersistedRole,
  AssetBundlePrimaryAsset,
  AssetBundleUploadResponse,
  AssetCategoryPathItem,
  AssetManifest,
  AssetManifestAsset,
  AssetManifestDirectory,
  AssetManifestEntry,
  AssetManifestResource,
  AssetManifestResourceKind,
  AssetSeries,
  AssetSummary,
  AssetTag,
  AssetTagSummary,
  AssetUploadResponse,
  LegacyAssetManifest,
  LegacyAssetManifestEntry,
  PagedRequest,
  PagedResponse,
} from './asset-api'
export {
  ASSET_BUNDLE_FORMAT,
  ASSET_BUNDLE_HASH_ALGORITHM,
  ASSET_BUNDLE_MANIFEST_FILENAME,
  ASSET_BUNDLE_VERSION,
} from './asset-api'

export {
  SCENE_PACKAGE_FORMAT,
  SCENE_PACKAGE_VERSION,
  isScenePackageManifest,
} from './scenePackage'
export type {
  ScenePackageManifest,
  ScenePackageManifestV1,
  ScenePackageProjectEntry,
  ScenePackageResourceEntry,
  ScenePackageResourceType,
  ScenePackageSceneEntry,
} from './scenePackage'

export {
  GROUND_SCATTER_SIDECAR_FILENAME,
  GROUND_SCATTER_SIDECAR_VERSION,
  serializeGroundScatterSidecar,
  deserializeGroundScatterSidecar,
} from './groundScatterSidecar'
export type { GroundScatterSidecarPayload } from './groundScatterSidecar'

export {
  GROUND_PAINT_SIDECAR_FILENAME,
  GROUND_PAINT_SIDECAR_VERSION,
  serializeGroundPaintSidecar,
  deserializeGroundPaintSidecar,
} from './groundPaintSidecar'
export type { GroundPaintSidecarPayload } from './groundPaintSidecar'

export {
  formatTerrainPaintChunkKey,
  parseTerrainPaintChunkKey,
  formatTerrainPaintTileKey,
  parseTerrainPaintTileKey,
  resolveTerrainPaintChunkBounds,
  resolveTerrainPaintTilesPerAxis,
  resolveTerrainPaintTileWorldBounds,
  decodeTerrainPaintMaskTileToData,
  sampleTerrainPaintMaskTileValue,
} from './terrainPaintTiles'
export type {
  TerrainPaintChunkBounds,
  TerrainPaintChunkKeyParts,
  TerrainPaintTileBounds,
  TerrainPaintTileKeyParts,
} from './terrainPaintTiles'

export {
  unzipScenePackage,
  buildAssetOverridesFromScenePackage,
  readBinaryFileFromScenePackage,
  readTextFileFromScenePackage,
} from './scenePackageZip'
export type { AssetOverrideBytes, AssetOverrideValue, ScenePackageUnzipped } from './scenePackageZip'

export {
  encodeScenePackageSceneDocument,
  decodeScenePackageSceneDocument,
} from './scenePackageSceneCodec'

export { getActiveMultiuserSceneId, setActiveMultiuserSceneId } from './multiuserContext'

export { createGradientBackgroundDome, disposeGradientBackgroundDome } from './gradientBackground'
export type { GradientBackgroundDome, GradientBackgroundSettingsInput } from './gradientBackground'

export { createAutoTourRuntime } from './autoTourRuntime'
export type {
  AutoTourRouteSnapResult,
  AutoTourRuntime,
  AutoTourRuntimeDeps,
  AutoTourVehicleInstanceLike,
} from './autoTourRuntime'

export { createWaterRuntime } from './waterRuntime'
export type { WaterRuntime, WaterRuntimeFrame } from './waterRuntime'

export {
  buildRegionWorldPoints,
  computeRegionCenter,
  buildRegionDynamicMeshFromWorldPoints,
  buildRegionDynamicMeshFromLocalVertices,
  normalizeRegionVertex2D,
  normalizeRegionVertices2D,
  isPointOnRegionSegmentXZ,
  isPointInsideRegionXZ,
} from './regionUtils'

export {
  DEFAULT_CAMERA_FOLLOW_TUNING,
  DEFAULT_OBJECT_SIZE_FALLBACK,
  FollowCameraController,
  computeFollowLerpAlpha,
  computeFollowPlacement,
  createCameraFollowState,
  resetCameraFollowState,
} from './followCameraController'
export type {
  CameraFollowContext,
  CameraFollowOptions,
  CameraFollowPlacement,
  CameraFollowState,
  CameraFollowTuning,
} from './followCameraController'

export { createScenePreviewPerfController } from './scenePreviewPerf'
export type { ScenePreviewPerfController, ScenePreviewPerfOptions } from './scenePreviewPerf'

export * from './instancedBillboardCache'

export { resolveEnabledComponentState } from './componentRuntimeUtils'

export { rebuildSceneNodeIndex, resolveSceneNodeById, resolveSceneParentNodeId } from './nodeIndexUtils'
export type { SceneNodeId, SceneNodeMap, SceneNodeParentMap } from './nodeIndexUtils'

export * from './instanceLayout'

export * from './components'

export {
  AssetTypes,
  DEFAULT_ASSET_TYPE,
  isAssetType,
  normalizeAssetType,
  type AssetType,
} from './asset-types'

export * from './assetTypeConversion'

export {
  buildAssetFileUrl,
  resolveServerAssetDownloadUrl,
  rewriteServerAssetUrlToBase,
} from './serverAssetUrl'
export type { ResolveServerAssetDownloadUrlOptions } from './serverAssetUrl'

export * from './mirror'

export {
  WATER_SURFACE_MESH_USERDATA_KEY,
  WATER_SURFACE_MESH_VERSION,
  normalizeWaterSurfaceMeshInput,
  cloneWaterSurfaceMeshMetadata,
  extractWaterSurfaceMeshMetadataFromUserData,
  createWaterSurfaceBufferGeometryFromMetadata,
  createWaterSurfaceRuntimeMesh,
} from './waterSurfaceMesh'
export type { WaterSurfaceMeshInput, WaterSurfaceMeshMetadata } from './waterSurfaceMesh'

export type Vector2Like = THREE.Vector2 | { x: number; y: number }
export type Vector3Like = THREE.Vector3 | { x: number; y: number; z: number }

export interface ProjectSceneMeta {
  id: string
  name: string
  /**
   * Authenticated API URL (login required) for downloading the stored scene JSON.
   * Example: /api/user-scenes/:id
   */
  sceneJsonUrl: string
  /**
   * Enforced by server: one scene belongs to exactly one project.
   */
  projectId: string
}

export interface Project {
  id: string
  name: string
  /**
   * Container only: does not embed the full scene JSON.
   * The first element is treated as the default scene.
   */
  scenes: ProjectSceneMeta[]
  /**
   * When opening a project, open this scene first; fallback to scenes[0].
   */
  lastEditedSceneId: string | null
}

export const PROJECT_EXPORT_BUNDLE_FORMAT = 'harmony-project-bundle' as const
export const PROJECT_EXPORT_BUNDLE_FORMAT_VERSION = 1 as const

export type ProjectExportSceneKind = 'embedded' | 'external'

export interface ProjectExportBundleResourceBreakdown {
  localAssetBytes: number
  embeddedAssetBytes: number
  planningImageBytes: number
  terrainBytes: number
  sidecarBytes: number
  sceneDocumentBytes: number
  manifestBytes: number
  projectBytes: number
  otherBytes: number
}

export interface ProjectExportBundleResourceSummary {
  logicalId: string
  resourceType: string
  path: string
  size: number
  mimeType?: string | null
  ext?: string | null
}

export interface ProjectExportBundleSceneSummary {
  sceneId: string
  name?: string | null
  checkpointTotal: number
  nodeCount: number
  sceneDocumentBytes: number
  sidecarBytes: number
  resourceBytes: number
}

export interface ProjectExportBundleMetadata {
  generatedAt: string
  sceneCount: number
  sceneOrder: string[]
  checkpointTotal: number
  nodeCountTotal: number
  resourceCount: number
  manifestResourceBytes: number
  uncompressedEntryBytes: number
  zipEntryCount: number
  breakdown: ProjectExportBundleResourceBreakdown
  largestResources: ProjectExportBundleResourceSummary[]
  sceneSummaries: ProjectExportBundleSceneSummary[]
}

export interface ProjectExportBundleProjectConfig {
  id: string
  name: string
  /**
   * Default scene to open first (export-time resolved).
   */
  defaultSceneId: string | null
  /**
   * Editor config carried through export.
   */
  lastEditedSceneId: string | null
  /**
   * Scene ids in export order (matches Scene Manager UI creation-time order).
   */
  sceneOrder: string[]
  /**
   * Total number of checkpoints across all scenes in the exported zip package.
   */
  checkpointTotal?: number
  /**
   * Export-time package statistics used for admin cost estimation and diagnostics.
   */
  metadata?: ProjectExportBundleMetadata
}

export type SceneNodeDownloadStatus = 'idle' | 'downloading' | 'ready' | 'error';
export type GeometryType =
  | 'Box'
  | 'Sphere'
  | 'Capsule'
  | 'Circle'
  | 'Cylinder'
  | 'Dodecahedron'
  | 'Icosahedron'
  | 'Lathe'
  | 'Octahedron'
  | 'Plane'
  | 'Ring'
  | 'Torus'
  | 'TorusKnot'
  | 'Empty';

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' | 'Environment' | 'Empty' | 'WarpGate' | 'Guideboard' | GeometryType;

export type PrimitiveNodeLike = GeometryType | SceneNodeType | string | null | undefined

export interface PrimitiveGeometryOptions {
  latheSegments?: number
}

export interface PrimitiveMeshOptions extends PrimitiveGeometryOptions {
  material?: THREE.Material | THREE.Material[]
  color?: THREE.ColorRepresentation
  doubleSided?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string | null
}

const DEFAULT_GEOMETRY_TYPE: GeometryType = 'Box'
const DEFAULT_COLOR: THREE.ColorRepresentation = 0xffffff
const DEFAULT_LATHE_SEGMENTS = 24

const LATHE_PROFILE: readonly THREE.Vector2[] = Array.from({ length: 10 }, (_value, index) => {
  const angle = index * 0.2
  return new THREE.Vector2(Math.sin(angle) * 0.5 + 0.5, (index - 5) * 0.2)
})
const GEOMETRY_FACTORIES: Record<GeometryType, (options?: PrimitiveGeometryOptions) => THREE.BufferGeometry> = {
  Box: () => new THREE.BoxGeometry(1, 1, 1),
  Sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
  Capsule: () => new THREE.CapsuleGeometry(0.5, 1, 16, 32),
  Circle: () => new THREE.CircleGeometry(0.5, 32),
  Cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32),
  Dodecahedron: () => new THREE.DodecahedronGeometry(0.6, 0),
  Icosahedron: () => new THREE.IcosahedronGeometry(0.6, 0),
  Lathe: (options) => new THREE.LatheGeometry([...LATHE_PROFILE], options?.latheSegments ?? DEFAULT_LATHE_SEGMENTS),
  Octahedron: () => new THREE.OctahedronGeometry(0.6, 0),
  Plane: () => new THREE.PlaneGeometry(1, 1, 1, 1),
  Ring: () => new THREE.RingGeometry(0.3, 0.6, 32),
  Torus: () => new THREE.TorusGeometry(0.5, 0.2, 16, 64),
  TorusKnot: () => new THREE.TorusKnotGeometry(0.4, 0.15, 120, 12),
  Empty: () => new THREE.BufferGeometry(),
}


export function isGeometryType(candidate: PrimitiveNodeLike): candidate is GeometryType {
  if (typeof candidate !== 'string') {
    return false
  }
  return candidate in GEOMETRY_FACTORIES
}

export function normalizeGeometryType(candidate: PrimitiveNodeLike): GeometryType {
  if (isGeometryType(candidate)) {
    return candidate
  }
  return DEFAULT_GEOMETRY_TYPE
}

export function createPrimitiveGeometry(
  type: PrimitiveNodeLike,
  options?: PrimitiveGeometryOptions,
): THREE.BufferGeometry {
  const geometryType = normalizeGeometryType(type)
  const factory = GEOMETRY_FACTORIES[geometryType] ?? GEOMETRY_FACTORIES[DEFAULT_GEOMETRY_TYPE]
  const geometry = factory(options)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildDefaultMaterial(color: THREE.ColorRepresentation, doubleSided?: boolean): THREE.Material {
  return createUvDebugMaterial({
    tint: color,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
}

export function createPrimitiveMesh(type: PrimitiveNodeLike, options?: PrimitiveMeshOptions): THREE.Mesh {
  const geometry = createPrimitiveGeometry(type, options)
  const material = options?.material ?? buildDefaultMaterial(options?.color ?? DEFAULT_COLOR, options?.doubleSided)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = options?.name ?? normalizeGeometryType(type)
  mesh.castShadow = options?.castShadow ?? true
  mesh.receiveShadow = options?.receiveShadow ?? true
  return mesh
}

export type SceneMaterialSide = 'front' | 'back' | 'double';

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive'
  | 'displacement';

export type SceneTextureWrapMode = 'ClampToEdgeWrapping' | 'RepeatWrapping' | 'MirroredRepeatWrapping';


export interface SceneMaterialTextureSettings {
  wrapS: SceneTextureWrapMode;
  wrapT: SceneTextureWrapMode;
  wrapR: SceneTextureWrapMode;
  offset: Vector2Like;
  repeat: Vector2Like;
  tileSizeMeters: Vector2Like;
  rotation: number;
  center: Vector2Like;
  matrixAutoUpdate: boolean;
  generateMipmaps: boolean;
  premultiplyAlpha: boolean;
  flipY: boolean;
}

export interface SceneMaterialTextureRef {
  assetId: string;
  name?: string;
  settings?: SceneMaterialTextureSettings;
}

export type SceneMaterialTextureSlotMap = Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>>;

export type SceneMaterialType =
  | 'MeshBasicMaterial'
  | 'MeshNormalMaterial'
  | 'MeshLambertMaterial'
  | 'MeshMatcapMaterial'
  | 'MeshPhongMaterial'
  | 'MeshToonMaterial'
  | 'MeshStandardMaterial'
  | 'MeshPhysicalMaterial';

export interface SceneMaterialProps {
  color: string;
  transparent: boolean;
  opacity: number;
  alphaTest?: number;
  side: SceneMaterialSide;
  wireframe: boolean;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  aoStrength: number;
  envMapIntensity: number;
  textures: SceneMaterialTextureSlotMap;
}

export interface SceneMaterial extends SceneMaterialProps {
  id: string;
  name: string;
  description?: string;
  type: SceneMaterialType;
  createdAt: string;
  updatedAt: string;
}

export interface SceneNodeMaterial extends SceneMaterialProps {
  id: string;
  type: SceneMaterialType;
  name?: string;
}
export type AssetSourceMetadata =
  | {
      type: 'server'
      serverAssetId?: string
    }
  | {
      type: 'package'
      providerId: string
      originalAssetId: string
      packagePathSegments?: string[]
    }
  | {
      type: 'local'
    }
  | {
      type: 'url'
    }

export type SceneAssetSourceType = 'server' | 'package' | 'url'

type SceneAssetCommonEntry = {
  assetType?: AssetType
  name?: string
  bytes?: number
  contentHash?: string | null
  contentHashAlgorithm?: AssetBundleHashAlgorithm | null
}

export type SceneAssetServerEntry = SceneAssetCommonEntry & {
  sourceType: 'server'
  /** Stable server-side asset id. Defaults to document asset id when omitted. */
  serverAssetId?: string
  /** Optional storage-relative file key for rebuilding CDN/static URLs. */
  fileKey?: string | null
  /** Optional resolved url cache for runtime fast path. */
  resolvedUrl?: string | null
}

export type SceneAssetPackageEntry = SceneAssetCommonEntry & {
  sourceType: 'package'
  /** Relative resource path in scene package zip. */
  zipPath: string
  /** Optional inline fallback for temporary compatibility paths. */
  inline?: string
}

export type SceneAssetUrlEntry = SceneAssetCommonEntry & {
  sourceType: 'url'
  url: string
}

export type SceneAssetRegistryEntry =
  | SceneAssetServerEntry
  | SceneAssetPackageEntry
  | SceneAssetUrlEntry

export type SceneAssetOverrideEntry = SceneAssetRegistryEntry

export interface SceneOutlineMesh {
  positions: number[]
  indices: number[]
  color?: string
  boundingSphere?: {
    center: Vector3Like
    radius: number
  } | null
  vertexCount: number
  triangleCount: number
}

export type SceneOutlineMeshMap = Record<string, SceneOutlineMesh>

export type SceneNodeOutlineMesh = SceneOutlineMesh

export type BehaviorEventType = 'click' | 'approach' | 'depart' | 'perform'

export type BehaviorScriptType =
  | 'delay'
  | 'moveTo'
  | 'showAlert'
  | 'bubble'
  | 'playSound'
  | 'watch'
  | 'showPurpose'
  | 'hidePurpose'
  | 'show'
  | 'hide'
  | 'showInfoBoard'
  | 'hideInfoBoard'
  | 'lantern'
  | 'look'
  | 'loadScene'
  | 'exitScene'
  | 'trigger'
  | 'animation'
  | 'showCockpit'
  | 'hideCockpit'
  | 'drive'
  | 'debus'
  | 'punch'

export interface DelayBehaviorParams {
  /** Duration to wait before continuing, measured in seconds. */
  seconds: number
}

export interface MoveToBehaviorParams {
  /** Target scene node id the camera should move to. */
  targetNodeId: string | null
  /** Camera travel duration in seconds. */
  duration: number
}

export interface ShowAlertBehaviorParams {
  /** Primary content text displayed inside the alert dialog. */
  content: string
  /** Optional asset identifier that overrides the inline content. */
  contentAssetId: string | null
  /** Display a confirmation button. */
  showConfirm: boolean
  /** Custom label for the confirmation button. */
  confirmText: string
  /** Display a cancel button. */
  showCancel: boolean
  /** Custom label for the cancel button. */
  cancelText: string
}

export interface InfoBoardBehaviorParams {
  /** Title shown in the info board header. */
  title: string
  /** Primary content text displayed inside the info board. */
  content: string
  /** Optional asset identifier that overrides the inline content. */
  contentAssetId: string | null
  /** Optional audio asset identifier for narration playback. */
  audioAssetId: string | null
}

export type BubbleBehaviorVariant = 'info' | 'success' | 'warning' | 'danger'

export type BubbleBehaviorAnimationPreset = 'fade' | 'float' | 'scale' | 'shake'

export type BubbleBehaviorAnchorMode = 'screenFixed' | 'nodeAnchored'

export interface BubbleBehaviorParams {
  /** Primary content text displayed inside the bubble. */
  content: string
  /** Optional asset identifier that overrides the inline content. */
  contentAssetId: string | null
  /** Bubble display duration in seconds after it becomes visible. */
  durationSeconds: number
  /** Delay before the bubble is shown, in seconds. */
  delaySeconds: number
  /** Whether the bubble stays fixed on screen or follows a node projection. */
  anchorMode: BubbleBehaviorAnchorMode
  /** Optional node used as the projection anchor when anchorMode is nodeAnchored. */
  targetNodeId: string | null
  /** Whether the same bubble can be shown repeatedly in a single session. */
  repeat: boolean
  /** Maximum distance from the camera to show the bubble. Values <= 0 disable the check. */
  maxDistanceMeters: number
  /** Visual style preset used by the runtime overlay. */
  styleVariant: BubbleBehaviorVariant
  /** Animation preset used when the bubble enters the screen. */
  animationPreset: BubbleBehaviorAnimationPreset
  /** Horizontal screen-space offset, measured in pixels. */
  screenOffsetX: number
  /** Vertical screen-space offset, measured in pixels. */
  screenOffsetY: number
  /** Additional world-space Y offset used when validating visibility. */
  worldOffsetY: number
  /** Require the source node anchor to be inside the current camera view before showing. */
  requireVisibleInView: boolean
}

export type SoundBehaviorCommand = 'play' | 'stop'

export type SoundPlaybackMode = 'once' | 'loop' | 'interval'

export type SoundDistanceResponseMode = 'off' | 'near-loud' | 'near-quiet'

export interface PlaySoundBehaviorParams {
  /** Audio asset id from the project asset registry. */
  assetId: string | null
  /** Whether this script starts playback or stops an active sound instance. */
  command: SoundBehaviorCommand
  /** Optional stable identifier used to stop or replace looping/interval sounds. */
  instanceKey: string | null
  /** Optional node used as the source position when spatial playback is enabled. */
  targetNodeId: string | null
  /** Use node-anchored spatial playback instead of listener-relative audio. */
  spatial: boolean
  /** One-shot, continuous loop, or repeated interval playback. */
  playbackMode: SoundPlaybackMode
  /** Output volume between 0 and 1. */
  volume: number
  /** Playback rate multiplier. */
  playbackRate: number
  /** Pitch shift in cents. */
  detuneCents: number
  /** Delay before playback starts, in seconds. */
  startDelaySeconds: number
  /** Optional playback cap in seconds. Values <= 0 disable auto-stop. */
  durationSeconds: number
  /** Fade-in duration in seconds. */
  fadeInSeconds: number
  /** Fade-out duration in seconds. */
  fadeOutSeconds: number
  /** Minimum delay between repeated interval sounds, in seconds. */
  minIntervalSeconds: number
  /** Maximum delay between repeated interval sounds, in seconds. */
  maxIntervalSeconds: number
  /** Maximum audible distance in meters for spatial playback. */
  maxDistanceMeters: number
  /** Distance at which volume begins to fall off for spatial playback. */
  refDistanceMeters: number
  /** Strength of spatial volume falloff. */
  rolloffFactor: number
  /** Optional secondary distance-response curve layered on top of base spatial falloff. */
  distanceResponseMode: SoundDistanceResponseMode
  /** Distance where the secondary response curve starts, in meters. */
  distanceResponseStartMeters: number
  /** Distance where the secondary response curve reaches its suppressed/full target, in meters. */
  distanceResponseEndMeters: number
  /** Gain used on the suppressed side of the secondary distance-response curve. */
  distanceResponseSuppressedGain: number
  /** Curve exponent applied to the secondary distance-response remap. */
  distanceResponseCurvePower: number
  /** Block the behavior sequence until a one-shot sound finishes playing. */
  waitForCompletion: boolean
}

export interface WatchBehaviorParams {
  /** Target scene node id to focus the camera on. */
  targetNodeId: string | null
  /** Lock the camera on the target while watching. Defaults to disabled. */
  caging?: boolean
}

export interface ShowPurposeBehaviorParams {
  /** Target scene node id to focus when the observe button is pressed. */
  targetNodeId: string | null
}

export interface HidePurposeBehaviorParams {
  // no configuration required
}

export interface ShowBehaviorParams {
  /** Target scene node id that should be forced visible. */
  targetNodeId: string | null
}

export interface HideBehaviorParams {
  /** Target scene node id that should be hidden. */
  targetNodeId: string | null
}

export interface AnimationBehaviorParams {
  /** Target node that owns the animation clip to play. */
  targetNodeId: string | null
  /** Identifier or name of the animation clip to play. */
  clipName: string | null
  /** Play the animation in a continuous loop. */
  loop: boolean
  /** Wait for the animation to finish before continuing. Ignored when loop is enabled. */
  waitForCompletion: boolean
}

export interface TriggerBehaviorParams {
  /** Node whose perform behaviors should be executed. */
  targetNodeId: string | null
  /** Optional sequence id identifying which perform behavior sequence to trigger. */
  sequenceId: string | null
}

export interface ShowCockpitBehaviorParams {
  // no configuration required
}

export interface HideCockpitBehaviorParams {
  // no configuration required
}

export interface DriveBehaviorParams {
  /** Vehicle node controlled by this behavior. Defaults to the behavior owner node. */
  targetNodeId: string | null
  /** Optional node used to attach the camera or player to the vehicle seat. */
  seatNodeId?: string | null
}

export interface DebusBehaviorParams {
  // no configuration required
}

export interface PunchBehaviorParams {
  // no configuration required
}

export interface LoadSceneBehaviorParams {
  /** Target scene id that should be opened by the runtime. */
  scene: string

  /**
   * When enabled, scene preview will push the current scene to the scene stack
   * before loading the next scene (so `exit-scene` can return).
   */
  pushToStack: boolean
}

export interface ExitSceneBehaviorParams {
  // no configuration required
}

export type LanternSlideLayout = 'imageTop' | 'imageLeft' | 'imageRight'

export interface LanternSlideDefinition {
  id: string
  title: string
  description: string
  descriptionAssetId: string | null
  imageAssetId: string | null
  layout: LanternSlideLayout
}

export interface LanternBehaviorParams {
  slides: LanternSlideDefinition[]
}

export interface LookBehaviorParams {
  // no configuration required
}

export type SceneBehaviorScriptBinding =
  | {
      type: 'delay'
      params: DelayBehaviorParams
    }
  | {
      type: 'moveTo'
      params: MoveToBehaviorParams
    }
  | {
      type: 'showAlert'
      params: ShowAlertBehaviorParams
    }
  | {
      type: 'bubble'
      params: BubbleBehaviorParams
    }
  | {
      type: 'playSound'
      params: PlaySoundBehaviorParams
    }
  | {
      type: 'watch'
      params: WatchBehaviorParams
    }
  | {
      type: 'showPurpose'
      params: ShowPurposeBehaviorParams
    }
  | {
      type: 'hidePurpose'
      params: HidePurposeBehaviorParams
    }
  | {
      type: 'show'
      params: ShowBehaviorParams
    }
  | {
      type: 'hide'
      params: HideBehaviorParams
    }
  | {
      type: 'showInfoBoard'
      params: InfoBoardBehaviorParams
    }
  | {
      type: 'hideInfoBoard'
      params: HidePurposeBehaviorParams
    }
  | {
      type: 'lantern'
      params: LanternBehaviorParams
    }
  | {
      type: 'look'
      params: LookBehaviorParams
    }
  | {
      type: 'loadScene'
      params: LoadSceneBehaviorParams
    }
  | {
      type: 'exitScene'
      params: ExitSceneBehaviorParams
    }
  | {
      type: 'trigger'
      params: TriggerBehaviorParams
    }
  | {
      type: 'animation'
      params: AnimationBehaviorParams
    }
  | {
      type: 'showCockpit'
      params: ShowCockpitBehaviorParams
    }
  | {
      type: 'hideCockpit'
      params: HideCockpitBehaviorParams
    }
  | {
      type: 'drive'
      params: DriveBehaviorParams
    }
  | {
      type: 'debus'
      params: DebusBehaviorParams
    }
  | {
      type: 'punch'
      params: PunchBehaviorParams
    }

export interface SceneBehavior {
  id: string
  name: string
  action: BehaviorEventType
  sequenceId: string
  script: SceneBehaviorScriptBinding
}

export type SceneBehaviorMap = Partial<Record<BehaviorEventType, SceneBehavior[]>>

export interface BehaviorComponentProps {
  behaviors: SceneBehavior[]
}

export type ComponentInspectorField<TProps = Record<string, unknown>> =
  | {
      kind: 'number'
      key: keyof TProps & string
      label: string
      min?: number
      max?: number
      step?: number
      precision?: number
      unit?: string
    }
  | {
      kind: 'boolean'
      key: keyof TProps & string
      label: string
    }
  | {
      kind: 'select'
      key: keyof TProps & string
      label: string
      options: Array<{ label: string; value: string }>
    }
  | {
      kind: 'text'
      key: keyof TProps & string
      label: string
      placeholder?: string
      multiline?: boolean
      rows?: number
    }

export interface ComponentInspectorSection<TProps = Record<string, unknown>> {
  id: string
  label: string
  fields: Array<ComponentInspectorField<TProps>>
}

export type NodeComponentType = string

export type SceneNodeComponentState<TProps = Record<string, unknown>, TMetadata = Record<string, unknown>> = {
  id: string
  type: NodeComponentType
  enabled: boolean
  props: TProps
  metadata?: TMetadata
}

export type SceneNodeComponentMap = Record<string, SceneNodeComponentState<any> | undefined>

export interface SceneNodeEditorFlags {
  ignoreGridSnapping?: boolean
  ignoreDropToGround?: boolean
  editorOnly?: boolean
  ignoreSelection?: boolean
}

export interface CameraNodeProperties {
  kind: 'perspective' | 'orthographic'
  near: number
  far: number
  fov?: number
  aspect?: number
  zoom?: number
}

export interface SceneNodeImportMetadata {
  assetId: string
  objectPath?: number[] | null
}

export type LightNodeType = 'Directional' | 'Point' | 'Spot' | 'Ambient' | 'Hemisphere'
export type CameraControlMode = 'orbit' | 'map'
export type CameraProjection = 'perspective' | 'orthographic'

export interface LightShadowProperties {
  /** Shadow map resolution (power of two recommended). */
  mapSize?: number
  /** Shadow bias to reduce acne. */
  bias?: number
  /** Shadow normal bias to reduce acne on low-angle surfaces. */
  normalBias?: number
  /** Blur radius (used by PCFSoftShadowMap). */
  radius?: number
  /** Shadow camera near plane. */
  cameraNear?: number
  /** Shadow camera far plane. */
  cameraFar?: number
  /** DirectionalLight only: orthographic half-extent (left/right/top/bottom = ±orthoSize). */
  orthoSize?: number
}

export interface LightNodeProperties {
  type: LightNodeType
  color: string
  /**
   * Secondary color used by some light types.
   * - Hemisphere: ground color (sky color uses `color`).
   */
  groundColor?: string
  intensity: number
  distance?: number
  angle?: number
  decay?: number
  penumbra?: number
  target?: Vector3Like
  castShadow?: boolean
  /** Shadow tuning parameters (only used when `castShadow` is true and light type supports shadows). */
  shadow?: LightShadowProperties
  /** (RectAreaLight removed) width originally used by RectArea light */
  width?: number
  /** (RectAreaLight removed) height originally used by RectArea light */
  height?: number
}
export interface SceneNode { 
  id: string;
  name: string;
  nodeType: SceneNodeType;
  position: Vector3Like;
  rotation: Vector3Like;
  scale: Vector3Like;
  /**
   * Mirror transform to apply at render time.
   * - 'horizontal' mirrors across the YZ plane (flip world X).
   * - 'vertical' mirrors across the XZ plane (flip world Y).
   */
  mirror?: 'horizontal' | 'vertical' | null;
  /**
   * Controls whether this node shows a selection highlight in the editor.
   * Defaults to true when omitted, except Ground nodes default to false.
   */
  selectedHighlight?: boolean;
  /** When false, this node cannot be saved as a prefab. Defaults to true when omitted. */
  canPrefab?: boolean;
  sourceAssetId?: string;
  visible?: boolean;
  locked?: boolean;
  isPlaceholder?: boolean;
  materials?: SceneNodeMaterial[];
  children?: SceneNode[];
  components?: SceneNodeComponentMap;
  light?: LightNodeProperties;
  camera?: CameraNodeProperties;
  dynamicMesh?: SceneDynamicMesh;
  importMetadata?: SceneNodeImportMetadata;
  editorFlags?: SceneNodeEditorFlags;
  downloadProgress?: number;
  downloadStatus?: SceneNodeDownloadStatus;
  downloadError?: string | null;
  /** Controls InstancedMesh rendering for this node (single instance or multi-instance layout). */
  instanceLayout?: SceneNodeInstanceLayout | null;
  userData?: Record<string, unknown> | null;
  groupExpanded?: boolean;
  allowChildNodes?: boolean;
}

export interface GroundSettings {
  width: number;
  depth: number;
  /** When true, build static air-wall colliders around the ground perimeter. */
  enableAirWall?: boolean;
  /** When true, editor viewports may dynamically load and unload ground scatter instances. */
  editorScatterDynamicStreamingEnabled?: boolean;
  /** When true, editor viewports render all ground scatter instances. */
  editorScatterVisible?: boolean;
}

export interface SceneViewportSettings {
  showGrid: boolean;
  showAxes: boolean;
  cameraProjection: CameraProjection;
  cameraControlMode: CameraControlMode;
  [key: string]: unknown;
}

export interface SceneJsonExportDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  environment?: EnvironmentSettings;
  nodes: SceneNode[];
  groundSettings?: GroundSettings;
  outlineMeshMap?: SceneOutlineMeshMap;
  /** Canonical asset source registry (single source of truth). */
  assetRegistry?: Record<string, SceneAssetRegistryEntry>;
  /** Project-level source override map. */
  projectOverrideAssets?: Record<string, SceneAssetOverrideEntry>;
  /** Scene-level source override map (higher priority than project overrides). */
  sceneOverrideAssets?: Record<string, SceneAssetOverrideEntry>;
  assetUrlOverrides?: Record<string, string>;
  resourceSummary?: SceneResourceSummary;
  lazyLoadMeshes?: boolean;
  assetPreload?: SceneAssetPreloadInfo;
  punchPoints?: ScenePunchPoint[];
}

export interface ScenePunchPoint {
  nodeId: string;
  nodeName: string;
}

export interface SceneAssetPreloadMeshInfo {
  all: string[];
  essential?: string[];
}

export interface SceneAssetPreloadInfo {
  mesh: SceneAssetPreloadMeshInfo;
}

export interface SceneResourceSummaryEntry {
  assetId: string;
  bytes: number;
  embedded?: boolean;
  inline?: boolean;
  downloadUrl?: string | null;
  source?: 'embedded' | 'remote' | 'inline';
  type?: AssetType;
  name?: string;
}

export interface SceneResourceMeshTextureUsage {
  nodeId: string;
  nodeName?: string;
  totalBytes: number;
  textureAssetIds: string[];
  textures: SceneResourceSummaryEntry[];
}

export interface SceneResourceSummary {
  totalBytes: number;
  embeddedBytes: number;
  externalBytes: number;
  computedAt: string;
  assets: SceneResourceSummaryEntry[];
  unknownAssetIds?: string[];
  excludedAssetIds?: string[];
  textureBytes?: number;
  meshTextureUsage?: SceneResourceMeshTextureUsage[];
}

export type EnvironmentBackgroundMode = 'solidColor' | 'hdri' | 'skycube'
export type EnvironmentFogMode = 'none' | 'linear' | 'exp'
export type EnvironmentNorthDirection = '+X' | '-X' | '+Z' | '-Z'

export type EnvironmentOrientationPreset = 'yUp' | 'zUp' | 'xUp' | 'custom'

export type SkyCubeBackgroundFormat = 'faces' | 'zip'

export interface EnvironmentRotationDegrees {
  /** Degrees */
  x: number
  /** Degrees */
  y: number
  /** Degrees */
  z: number
}

export interface EnvironmentBackgroundSettings {
  mode: EnvironmentBackgroundMode
  solidColor: string
  /**
  * Optional gradient background top color.
   * When provided (valid hex), background renders as a vertical gradient from solidColor (bottom) to gradientTopColor (top).
   * When omitted/invalid, background falls back to a pure solid color.
   */
  gradientTopColor?: string | null
  /** Vertical gradient offset (matches Three.js shader example semantics). Default: 33. */
  gradientOffset?: number
  /** Vertical gradient exponent (matches Three.js shader example semantics). Default: 0.6. */
  gradientExponent?: number
  hdriAssetId: string | null
  /** How SkyCube background sources its faces. */
  skycubeFormat: SkyCubeBackgroundFormat
  /** When skycubeFormat === 'zip', points to a .skycube zip asset containing 6 face images. */
  skycubeZipAssetId: string | null
  /**
   * SkyCube faces in fixed Three.js CubeTextureLoader order:
   * +X, -X, +Y, -Y, +Z, -Z.
   */
  positiveXAssetId: string | null
  negativeXAssetId: string | null
  positiveYAssetId: string | null
  negativeYAssetId: string | null
  positiveZAssetId: string | null
  negativeZAssetId: string | null
}

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  /** Which world axis should be treated as geographic north by viewers. */
  northDirection?: EnvironmentNorthDirection
  /**
   * Optional orientation helper for environment textures (HDRI / SkyCube).
   * Used by the editor UI to adapt cubemaps authored with different up axes.
   */
  environmentOrientationPreset?: EnvironmentOrientationPreset
  /** Rotation applied to scene.background / scene.environment in degrees. */
  environmentRotationDegrees?: EnvironmentRotationDegrees
  ambientLightColor: string
  ambientLightIntensity: number
  fogMode: EnvironmentFogMode
  fogColor: string
  fogDensity: number
  fogNear: number
  fogFar: number
  /** When true, linear fog and camera far can be adapted from the current ground footprint at runtime. */
  fogAutoFitToGround?: boolean
  /** When false, runtime physics remains loaded but does not advance simulation steps. */
  physicsEnabled?: boolean
  gravityStrength: number
  collisionRestitution: number
  collisionFriction: number
  csm?: EnvironmentCsmSettings
  /** Prefer viewport FPS over visual quality in editor postprocessing. */
  viewportPerformanceMode?: boolean
}

export interface EnvironmentCsmSettings {
  enabled: boolean
  shadowEnabled: boolean
  lightColor: string
  lightIntensity: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  cascades: number
  maxFar: number
  shadowMapSize: number
  shadowBias: number
}

export type EnvironmentSettingsPatch = Partial<EnvironmentSettings> & {
  background?: Partial<EnvironmentBackgroundSettings>
  csm?: Partial<EnvironmentCsmSettings>
}
export type DynamicMeshType = 'Ground' | 'Wall' | 'Road' | 'Floor' | 'Landform' | 'GuideRoute' | 'Region' | 'ModelCollision'

export type GroundHeightMap = Float64Array

export const GROUND_HEIGHT_UNSET_VALUE = Number.NaN

export function getGroundVertexColumns(columns: number): number {
  return Math.max(1, Math.trunc(columns)) + 1
}

export function getGroundVertexRows(rows: number): number {
  return Math.max(1, Math.trunc(rows)) + 1
}

export function getGroundVertexCount(rows: number, columns: number): number {
  return getGroundVertexRows(rows) * getGroundVertexColumns(columns)
}

export function getGroundVertexIndex(columns: number, row: number, column: number): number {
  return row * getGroundVertexColumns(columns) + column
}

export function createGroundHeightMap(rows: number, columns: number, fill = GROUND_HEIGHT_UNSET_VALUE): GroundHeightMap {
  const map = new Float64Array(getGroundVertexCount(rows, columns))
  map.fill(fill)
  return map
}

export function cloneGroundHeightMap(
  source: ArrayLike<number> | null | undefined,
  rows: number,
  columns: number,
  fill = GROUND_HEIGHT_UNSET_VALUE,
): GroundHeightMap {
  const target = createGroundHeightMap(rows, columns, fill)
  if (!source) {
    return target
  }
  const limit = Math.min(target.length, source.length ?? 0)
  for (let index = 0; index < limit; index += 1) {
    target[index] = Number(source[index])
  }
  return target
}

export function ensureGroundHeightMap(
  source: ArrayLike<number> | null | undefined,
  rows: number,
  columns: number,
  fill = GROUND_HEIGHT_UNSET_VALUE,
): GroundHeightMap {
  const expectedLength = getGroundVertexCount(rows, columns)
  if (source instanceof Float64Array && source.length === expectedLength) {
    return source
  }
  return cloneGroundHeightMap(source, rows, columns, fill)
}

export type GroundHeightCompositionMode = 'planning_plus_manual'

export type GroundContourBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export interface GroundPlanningMetadata {
  contourBounds?: GroundContourBounds | null
  generatedAt?: number
}

export type GroundGenerationMode = 'simple' | 'perlin' | 'ridge' | 'voronoi' | 'flat'

export interface GroundGenerationSettings {
  /** Optional deterministic seed for noise generation */
  seed?: number
  /** Controls the spatial frequency of the noise field */
  noiseScale: number
  /** Peak height variation in meters */
  noiseAmplitude: number
  /** Overall multiplier applied to the generated height field */
  noiseStrength?: number
  /** Optional secondary detail frequency multiplier */
  detailScale?: number
  /** Optional secondary amplitude multiplier for detail layer */
  detailAmplitude?: number
  /** Optional chunk sizing hint (mirrors legacy terrain editor params) */
  chunkSize?: number
  chunkResolution?: number
  worldWidth?: number
  worldDepth?: number
  /** Adjusts how aggressively the board edges fade toward zero */
  edgeFalloff?: number
  mode?: GroundGenerationMode
}

export type GroundSculptOperation = 'raise' | 'depress' | 'smooth' | 'flatten' | 'flatten-zero'

export type TerrainPaintChannel = 'r' | 'g' | 'b' | 'a'
export type TerrainPaintBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay'
export const TERRAIN_PAINT_V2_VERSION = 2 as const
export const TERRAIN_PAINT_V3_VERSION = 3 as const
export const TERRAIN_PAINT_VERSION = TERRAIN_PAINT_V2_VERSION
export const TERRAIN_PAINT_PAGE_CHANNELS = ['r', 'g', 'b', 'a'] as const
export const TERRAIN_PAINT_PAGE_SIZE = TERRAIN_PAINT_PAGE_CHANNELS.length
export const TERRAIN_PAINT_MAX_PAGE_COUNT = 4 as const
export const TERRAIN_PAINT_MAX_LAYER_COUNT = TERRAIN_PAINT_PAGE_SIZE * TERRAIN_PAINT_MAX_PAGE_COUNT
export const TERRAIN_PAINT_V3_TILE_RESOLUTION = 128 as const
export const TERRAIN_PAINT_V3_TILE_WORLD_SIZE = 8 as const

export const TERRAIN_PAINT_DEFAULT_OPACITY = 1
export const TERRAIN_PAINT_DEFAULT_ROTATION_DEG = 0
export const TERRAIN_PAINT_DEFAULT_TILE_SCALE = { x: 1, y: 1 } as const
export const TERRAIN_PAINT_DEFAULT_OFFSET = { x: 0, y: 0 } as const
export const TERRAIN_PAINT_DEFAULT_WORLD_SPACE = true

export interface TerrainPaintLayerStyle {
  opacity: number
  tileScale: { x: number; y: number }
  offset: { x: number; y: number }
  rotationDeg: number
  blendMode: TerrainPaintBlendMode
  worldSpace: boolean
}

function clampTerrainPaintFinite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampTerrainPaintBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampTerrainPaintVector2(
  value: Vector2Like | null | undefined,
  fallback: { x: number; y: number },
  min?: number,
): { x: number; y: number } {
  const x = clampTerrainPaintFinite(value?.x, fallback.x)
  const y = clampTerrainPaintFinite(value?.y, fallback.y)
  return {
    x: min === undefined ? x : Math.max(min, x),
    y: min === undefined ? y : Math.max(min, y),
  }
}

export function clampTerrainPaintBlendMode(value: unknown): TerrainPaintBlendMode {
  if (value === 'multiply' || value === 'screen' || value === 'overlay') {
    return value
  }
  return 'normal'
}

export function clampTerrainPaintLayerStyle(
  style: Partial<TerrainPaintLayerStyle> | null | undefined,
): TerrainPaintLayerStyle {
  return {
    opacity: Math.min(1, Math.max(0, clampTerrainPaintFinite(style?.opacity, TERRAIN_PAINT_DEFAULT_OPACITY))),
    tileScale: clampTerrainPaintVector2(style?.tileScale as Vector2Like | null | undefined, TERRAIN_PAINT_DEFAULT_TILE_SCALE, 0.001),
    offset: clampTerrainPaintVector2(style?.offset as Vector2Like | null | undefined, TERRAIN_PAINT_DEFAULT_OFFSET),
    rotationDeg: Math.min(360, Math.max(-360, clampTerrainPaintFinite(style?.rotationDeg, TERRAIN_PAINT_DEFAULT_ROTATION_DEG))),
    blendMode: clampTerrainPaintBlendMode(style?.blendMode),
    worldSpace: clampTerrainPaintBoolean(style?.worldSpace, TERRAIN_PAINT_DEFAULT_WORLD_SPACE),
  }
}

export function cloneTerrainPaintLayerStyle(style: TerrainPaintLayerStyle): TerrainPaintLayerStyle {
  return {
    opacity: style.opacity,
    tileScale: { x: style.tileScale.x, y: style.tileScale.y },
    offset: { x: style.offset.x, y: style.offset.y },
    rotationDeg: style.rotationDeg,
    blendMode: style.blendMode,
    worldSpace: style.worldSpace,
  }
}

export interface GroundSurfaceChunkTextureRef {
  textureAssetId: string
  revision: number
}

export type GroundSurfaceChunkTextureMap = Record<string, GroundSurfaceChunkTextureRef>

export function normalizeGroundSurfaceChunkTextureMap(
  value: GroundSurfaceChunkTextureMap | null | undefined,
): GroundSurfaceChunkTextureMap {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([chunkKey, chunkRef]) => {
        const normalizedChunkKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
        const textureAssetId = typeof chunkRef?.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
        if (!normalizedChunkKey || !textureAssetId) {
          return null
        }
        return [normalizedChunkKey, {
          textureAssetId,
          revision: Math.max(0, Math.trunc(clampTerrainPaintFinite(chunkRef?.revision, 0))),
        }] as const
      })
      .filter((entry): entry is readonly [string, GroundSurfaceChunkTextureRef] => Boolean(entry)),
  )
}

export interface GroundDynamicMesh {
  type: 'Ground'
  width: number
  depth: number
  rows: number
  columns: number
  cellSize: number
  optimizedMesh?: GroundOptimizedMeshData | null
  /** When false, load all terrain chunks eagerly instead of streaming them around the camera. */
  chunkStreamingEnabled?: boolean
  /** Monotonic revision for changes that affect rendered ground surface heights. */
  surfaceRevision?: number
  heightComposition: {
    mode: GroundHeightCompositionMode
    policyVersion?: number
  }
  planningMetadata?: GroundPlanningMetadata | null
  /** When true, ground chunk meshes will cast shadows (more expensive on large grounds). */
  castShadow?: boolean
  terrainScatterInstancesUpdatedAt: number
  textureDataUrl?: string | null
  textureName?: string | null
  generation?: GroundGenerationSettings | null
  terrainScatter?: TerrainScatterStoreSnapshot | null
  /** @deprecated Ground paint now persists via groundSurfaceChunks only. */
  terrainPaint?: null
  groundSurfaceChunks?: GroundSurfaceChunkTextureMap | null
  terrainPaintBakedTextureAssetId?: string | null
}

export type GroundRuntimeDynamicMesh = GroundDynamicMesh & {
  manualHeightMap: GroundHeightMap
  planningHeightMap: GroundHeightMap
  /** Runtime-only hydration state used to distinguish untouched sidecar restore from in-session edits. */
  runtimeHydratedHeightState?: 'pristine' | 'dirty'
  /** Runtime-only guard to bypass optimized streamed chunk geometry when sidecar/runtime overrides are active. */
  runtimeDisableOptimizedChunks?: boolean
}

export type GroundOptimizedMeshData = {
  chunkCells: number
  chunkCount: number
  chunks: GroundOptimizedMeshChunkData[]
  sourceVertexCount: number
  sourceTriangleCount: number
  optimizedVertexCount: number
  optimizedTriangleCount: number
  optimizedRowCount: number
  optimizedColumnCount: number
  /** Source editing/runtime chunk size before publish-time render coarsening. */
  sourceChunkCells: number
}

export type GroundOptimizedMeshChunkData = {
  chunkRow: number
  chunkColumn: number
  startRow: number
  startColumn: number
  rows: number
  columns: number
  positions: number[]
  uvs: number[]
  indices: number[]
  vertexCount: number
  triangleCount: number
  sourceVertexCount: number
  sourceTriangleCount: number
  optimizedRowCount: number
  optimizedColumnCount: number
}

/**
 * A single chain (polyline) of control points for a wall.
 * Points are stored in local space relative to the wall node origin.
 */
export type WallChain = {
  /** Control points in local space, ≥ 2 required. */
  points: Vector3Like[]
  /** When true the last point implicitly connects back to the first (closed loop). */
  closed: boolean
}

/**
 * An arc-length interval on a specific chain that should be left open (gap / hole).
 */
export type WallOpening = {
  /** Zero-based index into WallDynamicMesh.chains. */
  chainIndex: number
  /** Arc-length start measured from the chain start (metres). */
  start: number
  /** Arc-length end measured from the chain start (metres). */
  end: number
}

export type WallRepeatErasedSlot = {
  /** Zero-based index into WallDynamicMesh.chains. */
  chainIndex: number
  /** Zero-based repeated instance slot index within the chain. */
  slotIndex: number
}

export interface WallDynamicMesh {
  type: 'Wall'
  /** One or more polyline chains that together form this wall node. */
  chains: WallChain[]
  /**
   * Arc-length intervals on individual chains that should be left open.
   * Openings are used for doorways, windows, etc.
   * Sorted and non-overlapping per chain after every write.
   */
  openings: WallOpening[]
  /**
   * repeatInstances mode only: instance slots removed by editor door selection.
   * This is intentionally separated from `openings` (stretch mode).
   */
  repeatErasedSlots?: WallRepeatErasedSlot[]
  /** Material config id used for the wall body mesh (editor-defined). */
  bodyMaterialConfigId?: string | null
  /** Shared dimensions applied to every chain segment. */
  dimensions: { height: number; width: number; thickness: number }
}

export type RoadVertex2D = [number, number]

export type RoadSegment = {
  /** Index into `vertices`. */
  a: number
  /** Index into `vertices`. */
  b: number
}

export interface RoadDynamicMesh {
  type: 'Road'
  /** Default road width in meters. */
  width: number

  /**
   * Road graph vertices projected onto the ground.
   * Each entry is a 2D point: [x, y] where y maps to world-space z.
   * Height is implicitly 0.
   */
  vertices: RoadVertex2D[]

  /** Connections between vertices. Supports branching roads. */
  segments: RoadSegment[]
}

export type FloorVertex2D = [number, number]

export type RegionVertex2D = [number, number]

export interface FloorDynamicMesh {
  type: 'Floor'
  /**
   * Floor polygon vertices projected onto the ground.
   * Each entry is a 2D point: [x, y] where y maps to world-space z.
   * Height is implicitly 0.
   */
  vertices: FloorVertex2D[]
  /** Material config id used for the top/bottom surface mesh (editor-defined). */
  topBottomMaterialConfigId?: string | null
  /** Material config id used for the side-wall mesh (editor-defined). */
  sideMaterialConfigId?: string | null
  /** Controls how rounded the floor corners are. */
  smooth?: number
  /** Extrusion thickness in meters. 0 generates a flat floor. */
  thickness?: number

  /**
   * Side-wall UV repeats per meter.
   * - x: repeats per meter along the perimeter direction (U)
   * - y: repeats per meter along height (V)
   */
  sideUvScale?: Vector2Like | null
}

export interface LandformDynamicMesh {
  type: 'Landform'
  /** Original closed footprint polygon in local XZ space. */
  footprint: FloorVertex2D[]
  /** Terrain-conforming local-space surface vertices. */
  surfaceVertices: Vector3Like[]
  /** Triangle indices for the terrain-conforming surface. */
  surfaceIndices: number[]
  /** Optional UV coordinates per surface vertex. */
  surfaceUvs?: Vector2Like[] | null
  /** Optional feather weight per surface vertex. 0 = transparent edge, 1 = full opacity. */
  surfaceFeather?: number[] | null
  /** Material config id used for the landform surface mesh. */
  materialConfigId?: string | null
  /** Whether feathered edge fading is enabled for this landform surface. */
  enableFeather?: boolean
  /** Feather width in meters used when computing surfaceFeather. */
  feather?: number
  /** Surface UV scale in local XZ meters per UV repeat (U/V). */
  uvScale?: Vector2Like | null
}

export interface GuideRouteDynamicMesh {
  type: 'GuideRoute'
  /** Ordered waypoint vertices in local space relative to the node origin. */
  vertices: Vector3Like[]
}

export interface RegionDynamicMesh {
  type: 'Region'
  /** Closed polygon vertices projected onto local XZ space. */
  vertices: RegionVertex2D[]
}

export interface ModelCollisionFace {
  /** Stable face id used by the editor overlay and edit selection. */
  id: string
  /** Closed polygon vertices in the target node's local space. */
  vertices: Vector3Like[]
  /** Optional per-face collision thickness override in meters. */
  thickness?: number
}

export interface ModelCollisionDynamicMesh {
  type: 'ModelCollision'
  /** Closed collision faces attached to an arbitrary model node. */
  faces: ModelCollisionFace[]
  /** Default collision thickness used when faces omit a per-face override. */
  defaultThickness?: number
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | RoadDynamicMesh | FloorDynamicMesh | LandformDynamicMesh | GuideRouteDynamicMesh | RegionDynamicMesh | ModelCollisionDynamicMesh

export interface ClipboardEntry {
  sourceId: string
  sourceParentId?: string | null
  root: SceneNode
  serialized: string
}

export interface SceneClipboard {
  entries: ClipboardEntry[]
  runtimeSnapshots: Map<string, THREE.Object3D>
  cut: boolean
}
