
import * as THREE from 'three'

export { AssetCache, AssetLoader } from './assetCache'
export type { AssetCacheEntry, AssetCacheStatus, AssetSource, AssetLoadOptions } from './assetCache'

export type { AssetType } from './asset-types'
export { AssetTypes, DEFAULT_ASSET_TYPE, isAssetType, normalizeAssetType } from './asset-types'
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

export type Vector2Like = THREE.Vector2 | { x: number; y: number }
export type Vector3Like = THREE.Vector3 | { x: number; y: number; z: number }

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
  | 'TorusKnot';

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' |'Sky'| 'Environment' | GeometryType;

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

export function isGeometryType(candidate: PrimitiveNodeLike): candidate is GeometryType

export function normalizeGeometryType(candidate: PrimitiveNodeLike): GeometryType

export function createPrimitiveGeometry(
  type: PrimitiveNodeLike,
  options?: PrimitiveGeometryOptions,
): THREE.BufferGeometry

export function createPrimitiveMesh(
  type: PrimitiveNodeLike,
  options?: PrimitiveMeshOptions,
): THREE.Mesh

export type SceneMaterialSide = 'front' | 'back' | 'double';

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive';

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
}


export interface CameraNodeProperties {
  kind: CameraProjection
  fov?: number
  near: number
  far: number
  aspect?: number
  zoom?: number
}

export interface SceneNodeImportMetadata {
  assetId: string
  objectPath: number[]
}
export type NodeComponentType = string

export interface SceneNodeComponentState<TProps = Record<string, unknown>> {
  id: string
  type: NodeComponentType
  enabled: boolean
  props: TProps
  metadata?: Record<string, unknown>
}

export type SceneNodeComponentMap = Partial<Record<NodeComponentType, SceneNodeComponentState<any>>>

export interface SceneNodeEditorFlags {
  editorOnly?: boolean
  ignoreGridSnapping?: boolean
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
  | 'trigger'
  | 'animation'

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
      type: 'trigger'
      params: TriggerBehaviorParams
    }
  | {
      type: 'animation'
      params: AnimationBehaviorParams
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
export type LightNodeType = 'Directional' | 'Point' | 'Spot' | 'Ambient'
export type CameraControlMode = 'orbit' | 'map'
export type CameraProjection = 'perspective' | 'orthographic'

export interface LightNodeProperties {
  type: LightNodeType
  color: string
  intensity: number
  distance?: number
  angle?: number
  decay?: number
  penumbra?: number
  target?: Vector3Like
  castShadow?: boolean
}
export interface SceneNode { 
  id: string;
  name: string;
  nodeType: SceneNodeType;
  position: Vector3Like;
  rotation: Vector3Like;
  scale: Vector3Like;
  offset?: Vector3Like;
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
  userData?: Record<string, unknown> | null;
}

export interface GroundSettings {
  width: number;
  depth: number;
}

export interface SceneViewportSettings {
  showGrid: boolean;
  showAxes: boolean;
  cameraProjection: CameraProjection;
  cameraControlMode: CameraControlMode;
  shadowsEnabled: boolean;
  skybox: SceneSkyboxSettings;
  [key: string]: unknown;
}

export interface SceneJsonExportDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  skybox: SceneSkyboxSettings;
  nodes: SceneNode[];
  materials: SceneMaterial[];
  groundSettings?: GroundSettings;
  assetIndex?: Record<string, AssetIndexEntry>;
  packageAssetMap?: Record<string, string>;
  outlineMeshMap?: SceneOutlineMeshMap;
}

export interface SceneSkyboxSettings {
  presetId: string
  exposure: number
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  elevation: number
  azimuth: number
}
export type DynamicMeshType = 'Ground' | 'Wall' | 'Platform'

export interface GroundHeightMap {
  [key: string]: number
}

export interface GroundDynamicMesh {
  type: 'Ground'
  width: number
  depth: number
  rows: number
  columns: number
  cellSize: number
  heightMap: GroundHeightMap
  textureDataUrl?: string | null
  textureName?: string | null
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

export interface PlatformDynamicMesh {
  type: 'Platform'
  /**
   * Placeholder polygon footprint described in clockwise order.
   */
  footprint: Vector3Like[]
  height: number
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | PlatformDynamicMesh
