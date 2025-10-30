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

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type SceneMaterialSide = 'front' | 'back' | 'double';

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive';

export type SceneTextureWrapMode = 'ClampToEdgeWrapping' | 'RepeatWrapping' | 'MirroredRepeatWrapping';

export interface SceneTextureVector2 {
  x: number;
  y: number;
}

export interface SceneMaterialTextureSettings {
  wrapS: SceneTextureWrapMode;
  wrapT: SceneTextureWrapMode;
  wrapR: SceneTextureWrapMode;
  offset: SceneTextureVector2;
  repeat: SceneTextureVector2;
  rotation: number;
  center: SceneTextureVector2;
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

export type SceneNodeDownloadStatus = 'idle' | 'downloading' | 'ready' | 'error';

export interface SceneNodeBase<
  TMaterial extends SceneNodeMaterial = SceneNodeMaterial,
  TComponent = unknown,
  TLight = unknown,
  TCamera = unknown,
  TDynamicMesh = unknown,
  TImportMetadata = unknown,
> {
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
  materials?: TMaterial[];
  children?: SceneNodeBase<TMaterial, TComponent, TLight, TCamera, TDynamicMesh, TImportMetadata>[];
  components?: TComponent[];
  light?: TLight;
  camera?: TCamera;
  dynamicMesh?: TDynamicMesh;
  importMetadata?: TImportMetadata;
  downloadProgress?: number;
  downloadStatus?: SceneNodeDownloadStatus;
  downloadError?: string | null;
}

export type SceneNode = SceneNodeBase;

export interface GroundSettings {
  width: number;
  depth: number;
}

export interface SceneJsonExportDocument<
  TNode extends SceneNodeBase = SceneNodeBase,
  TMaterial extends SceneMaterial = SceneMaterial,
  TAssetIndex extends Record<string, unknown> = Record<string, unknown>,
  TPackageAssetMap extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: TNode[];
  materials: TMaterial[];
  groundSettings?: GroundSettings;
  assetIndex?: TAssetIndex;
  packageAssetMap?: TPackageAssetMap;
}
