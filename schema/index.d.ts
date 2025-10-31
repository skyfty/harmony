
import * as THREE from 'three'

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

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' | GeometryType;

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
  kind: 'perspective' | 'orthographic'
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

export type BehaviorActionType = 'click' | 'hover' | 'drag'

export type BehaviorScriptType = 'showAlert'

export interface ShowAlertBehaviorParams {
  title?: string
  message: string
}

export type SceneBehaviorScriptBinding =
  | {
      type: 'showAlert'
      params: ShowAlertBehaviorParams
    }

export interface SceneBehavior {
  id: string
  name: string
  action: BehaviorActionType
  script: SceneBehaviorScriptBinding
}

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
  downloadProgress?: number;
  downloadStatus?: SceneNodeDownloadStatus;
  downloadError?: string | null;
}

export interface GroundSettings {
  width: number;
  depth: number;
}

export interface SceneViewportSettings {
  showGrid: boolean;
  showAxes: boolean;
  cameraProjection: 'perspective' | 'orthographic';
  cameraControlMode: 'orbit' | 'map';
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
