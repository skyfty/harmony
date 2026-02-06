
import * as THREE from 'three'
import type { SceneNodeInstanceLayout } from './instanceLayout'
import type { TerrainScatterStoreSnapshot } from './terrain-scatter'
import type { AssetType } from './asset-types'
import { createUvDebugMaterial } from './debugTextures'

export const GROUND_NODE_ID = 'harmony:ground'
export const SKY_NODE_ID = 'harmony:sky'
export const ENVIRONMENT_NODE_ID = 'harmony:environment'
export const MULTIUSER_NODE_ID = 'harmony:multiuser'
export const PROTAGONIST_NODE_ID = 'harmony:protagonist'

export { AssetCache, AssetLoader } from './assetCache'
export type { AssetCacheEntry, AssetCacheStatus, AssetSource, AssetLoadOptions } from './assetCache'

export { getDefaultUvDebugTexture, createUvDebugMaterial } from './debugTextures'

export { TerrainScatterCategories } from './terrain-scatter'
export type { TerrainScatterCategory } from './terrain-scatter'
export type {
  AssetCategory,
  AssetCategoryPathItem,
  AssetDirectory,
  AssetManifest,
  AssetManifestEntry,
  AssetSeries,
  AssetSummary,
  AssetTag,
  AssetTagSummary,
  AssetUploadResponse,
  PagedRequest,
  PagedResponse,
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
  unzipScenePackage,
  buildAssetOverridesFromScenePackage,
  readTextFileFromScenePackage,
} from './scenePackageZip'
export type { AssetOverrideBytes, AssetOverrideValue, ScenePackageUnzipped } from './scenePackageZip'

export { getActiveMultiuserSceneId, setActiveMultiuserSceneId } from './multiuserContext'

export { createAutoTourRuntime } from './autoTourRuntime'
export type { AutoTourRuntime, AutoTourRuntimeDeps, AutoTourVehicleInstanceLike } from './autoTourRuntime'

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

export * from './mirror'

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

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' | 'Sky' | 'Environment' | 'Empty' | 'WarpGate' | 'Guideboard' | GeometryType;

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
  materialId: string | null;
  type: SceneMaterialType;
  name?: string;
}
export type AssetSourceMetadata =
  | {
      type: 'package'
      providerId: string
      originalAssetId: string
    }
  | {
      type: 'local'
    }
  | {
      type: 'url'
    }

export interface AssetIndexEntry {
  categoryId: string
  source?: AssetSourceMetadata
  /** Internal assets are managed by the editor/runtime and should not be shown in user-facing asset lists. */
  internal?: boolean
}

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
  | 'watch'
  | 'showPurpose'
  | 'hidePurpose'
  | 'show'
  | 'hide'
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

export type LightNodeType = 'Directional' | 'Point' | 'Spot' | 'Ambient' | 'Hemisphere' | 'RectArea'
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
  /** RectAreaLight width (only when type === 'RectArea') */
  width?: number
  /** RectAreaLight height (only when type === 'RectArea') */
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
  skybox: SceneSkyboxSettings;
  environment?: EnvironmentSettings;
  nodes: SceneNode[];
  materials: SceneMaterial[];
  groundSettings?: GroundSettings;
  outlineMeshMap?: SceneOutlineMeshMap;
  assetIndex?: Record<string, AssetIndexEntry>;
  packageAssetMap?: Record<string, string>;
  resourceSummary?: SceneResourceSummary;
  lazyLoadMeshes?: boolean;
  assetPreload?: SceneAssetPreloadInfo;
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
  textureBytes?: number;
  meshTextureUsage?: SceneResourceMeshTextureUsage[];
}

export type SceneCloudImplementation = 'cubeTexture' | 'spherical' | 'volumetric';

export interface SceneCubeTextureCloudSettings {
  mode: 'cubeTexture';
  /** Cube map face on the +X axis. */
  positiveX: string;
  /** Cube map face on the -X axis. */
  negativeX: string;
  /** Cube map face on the +Y axis. */
  positiveY: string;
  /** Cube map face on the -Y axis. */
  negativeY: string;
  /** Cube map face on the +Z axis. */
  positiveZ: string;
  /** Cube map face on the -Z axis. */
  negativeZ: string;
  /** Blends the cubemap clouds with the analytic sky. */
  intensity: number;
}

export interface SceneSphericalCloudSettings {
  mode: 'spherical';
  /** Optional texture asset applied to the spherical cloud layer. */
  textureAssetId: string | null;
  /** Radius of the spherical cloud dome. */
  radius: number;
  /** Cloud layer opacity between 0 and 1. */
  opacity: number;
  /** Angular rotation speed in radians per second. */
  rotationSpeed: number;
  /** Tint color for the cloud material. */
  color: string;
  /** Height offset for positioning the cloud dome. */
  height: number;
}

export interface SceneVolumetricCloudSettings {
  mode: 'volumetric';
  /** Tint color for the cloud material. */
  color: string;
  /** Cloud density multiplier. */
  density: number;
  /** Cloud movement speed. */
  speed: number;
  /** Cloud detail level (0-10). */
  detail: number;
  /** Cloud coverage (0-1). */
  coverage: number;
  /** Height offset. */
  height: number;
  /** Cloud scale/size. */
  size: number;
  /** Shadow opacity (0-1). Higher is darker shadows. */
  shadowOpacity?: number;
  /** Sun light intensity (0-1). */
  sunIntensity?: number;
  /** Ambient light intensity (0-1). */
  ambientIntensity?: number;
}

export type SceneCloudSettings =
  | SceneCubeTextureCloudSettings
  | SceneSphericalCloudSettings
  | SceneVolumetricCloudSettings;

export interface SceneSkyboxSettings {
  presetId: string
  exposure: number
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  elevation: number
  azimuth: number
  clouds?: SceneCloudSettings | null
}

export type EnvironmentBackgroundMode = 'skybox' | 'solidColor' | 'hdri'
export type EnvironmentMapMode = 'skybox' | 'custom'
export type EnvironmentFogMode = 'none' | 'linear' | 'exp'

export interface EnvironmentBackgroundSettings {
  mode: EnvironmentBackgroundMode
  solidColor: string
  hdriAssetId: string | null
}

export interface EnvironmentMapSettings {
  mode: EnvironmentMapMode
  hdriAssetId: string | null
}

export interface EnvironmentSettings {
  background: EnvironmentBackgroundSettings
  ambientLightColor: string
  ambientLightIntensity: number
  fogMode: EnvironmentFogMode
  fogColor: string
  fogDensity: number
  fogNear: number
  fogFar: number
  environmentMap: EnvironmentMapSettings
  gravityStrength: number
  collisionRestitution: number
  collisionFriction: number
}

export type EnvironmentSettingsPatch = Partial<EnvironmentSettings> & {
  background?: Partial<EnvironmentBackgroundSettings>
  environmentMap?: Partial<EnvironmentMapSettings>
}
export type DynamicMeshType = 'Ground' | 'Wall' | 'Road' | 'Floor' | 'GuideRoute'

export interface GroundHeightMap {
  [key: string]: number
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

export interface TerrainPaintLayerDefinition {
  /** Which RGBA channel this layer occupies in the weightmap. */
  channel: TerrainPaintChannel
  /** Texture/image asset id to blend for this layer. */
  textureAssetId: string
}

export interface TerrainPaintChunkWeightmapRef {
  /** Stable content id (recommended: `sha256-...`) of the chunk RGBA weightmap PNG stored as a private resource. */
  logicalId: string
}

export type TerrainPaintChunkWeightmapMap = Record<string, TerrainPaintChunkWeightmapRef>

export interface TerrainPaintSettings {
  /** Versioned payload to allow schema migrations later. */
  version: 1
  /** Weightmap resolution per chunk (pixels per side). */
  weightmapResolution: number
  /** Non-base paint layers. Base is always the ground material color. */
  layers: TerrainPaintLayerDefinition[]
  /**
   * Weightmap asset references keyed by chunk key (e.g., "0:0").
   * Each chunk has one 4-channel texture mapping [Base, LayerG, LayerB, LayerA].
   * The actual image data is stored in the project's private asset storage (or similar).
   */
  chunks: TerrainPaintChunkWeightmapMap
}

export interface GroundDynamicMesh {
  type: 'Ground'
  width: number
  depth: number
  rows: number
  columns: number
  cellSize: number
  heightMap: GroundHeightMap
  terrainScatterInstancesUpdatedAt: number
  textureDataUrl?: string | null
  textureName?: string | null
  generation?: GroundGenerationSettings | null
  hasManualEdits?: boolean
  terrainScatter?: TerrainScatterStoreSnapshot | null
  terrainPaint?: TerrainPaintSettings | null
}

export type WallSegment = {
  start: Vector3Like
  end: Vector3Like
  height: number
  width: number
  thickness: number
}

export interface WallDynamicMesh {
  type: 'Wall'
  /**
   * Placeholder control points describing wall segments in row-major order.
   * Each entry stores start and end positions in world space relative to the wall origin.
   */
  segments: WallSegment[]
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

export interface GuideRouteDynamicMesh {
  type: 'GuideRoute'
  /** Ordered waypoint vertices in local space relative to the node origin. */
  vertices: Vector3Like[]
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | RoadDynamicMesh | FloorDynamicMesh | GuideRouteDynamicMesh

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
