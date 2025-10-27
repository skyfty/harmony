export type SceneMaterialSide = 'front' | 'back' | 'double'

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive'

export type SceneTextureWrapMode = 'ClampToEdgeWrapping' | 'RepeatWrapping' | 'MirroredRepeatWrapping'

export interface SceneTextureVector2 {
  x: number
  y: number
}

export interface SceneMaterialTextureSettings {
  wrapS: SceneTextureWrapMode
  wrapT: SceneTextureWrapMode
  wrapR: SceneTextureWrapMode
  offset: SceneTextureVector2
  repeat: SceneTextureVector2
  rotation: number
  center: SceneTextureVector2
  matrixAutoUpdate: boolean
  generateMipmaps: boolean
  premultiplyAlpha: boolean
  flipY: boolean
}

export interface SceneMaterialTextureRef {
  assetId: string
  name?: string
  settings?: SceneMaterialTextureSettings
}

export type SceneMaterialType =
  | 'MeshBasicMaterial'
  | 'MeshNormalMaterial'
  | 'MeshLambertMaterial'
  | 'MeshMatcapMaterial'
  | 'MeshPhongMaterial'
  | 'MeshToonMaterial'
  | 'MeshStandardMaterial'
  | 'MeshPhysicalMaterial'

export interface SceneMaterialProps {
  color: string
  transparent: boolean
  opacity: number
  side: SceneMaterialSide
  wireframe: boolean
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  aoStrength: number
  envMapIntensity: number
  textures: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>>
}

export interface SceneMaterial extends SceneMaterialProps {
  id: string
  name: string
  description?: string
  type: SceneMaterialType
  createdAt: string
  updatedAt: string
}

export interface SceneNodeMaterial extends SceneMaterialProps {
  id: string
  materialId: string | null
  type: SceneMaterialType
  name?: string
}

export interface Vector3Like {
  x: number
  y: number
  z: number
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

export interface CameraNodeProperties {
  kind: 'perspective' | 'orthographic'
  fov?: number
  near: number
  far: number
  aspect?: number
  zoom?: number
}

export interface SceneNodeComponentState<TProps = Record<string, unknown>> {
  id: string
  type: string
  enabled: boolean
  props: TProps
  metadata?: Record<string, unknown>
}

export type DynamicMeshType = 'Ground' | 'Wall' | 'Platform'

export interface GroundDynamicMesh {
  type: 'Ground'
  width: number
  depth: number
  rows: number
  columns: number
  cellSize: number
  heightMap: Record<string, number>
  textureDataUrl?: string | null
  textureName?: string | null
}

export interface WallSegment {
  start: Vector3Like
  end: Vector3Like
  height: number
  width: number
  thickness: number
}

export interface WallDynamicMesh {
  type: 'Wall'
  segments: WallSegment[]
}

export interface PlatformDynamicMesh {
  type: 'Platform'
  footprint: Vector3Like[]
  height: number
}

export type SceneDynamicMesh = GroundDynamicMesh | WallDynamicMesh | PlatformDynamicMesh

export type SceneNodeType = 'Mesh' | 'Light' | 'Group' | 'Camera' | 'Box' | 'Sphere' | 'Capsule' | 'Circle' | 'Cylinder' | 'Dodecahedron' | 'Icosahedron' | 'Lathe' | 'Octahedron' | 'Plane' | 'Ring' | 'Torus' | 'TorusKnot'

export interface SceneNode {
  id: string
  name: string
  nodeType: SceneNodeType
  materials?: SceneNodeMaterial[]
  components?: SceneNodeComponentState<any>[]
  light?: LightNodeProperties
  camera?: CameraNodeProperties
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
  children?: SceneNode[]
  sourceAssetId?: string
  visible?: boolean
  locked?: boolean
  isPlaceholder?: boolean
  dynamicMesh?: SceneDynamicMesh
}

export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
  forward?: Vector3Like
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

export interface SceneViewportSettings {
  showGrid: boolean
  showAxes: boolean
  cameraProjection: 'perspective' | 'orthographic'
  cameraControlMode: 'orbit' | 'map'
  shadowsEnabled: boolean
  skybox: SceneSkyboxSettings
}

export interface GroundSettings {
  width: number
  depth: number
}

export interface PanelVisibilityState {
  hierarchy: boolean
  inspector: boolean
  project: boolean
}

export interface PanelPlacementState {
  hierarchy: 'floating' | 'docked'
  inspector: 'floating' | 'docked'
  project: 'floating' | 'docked'
}

export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'image' | 'texture' | 'material' | 'file'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
  gleaned: boolean
}

export interface AssetIndexEntry {
  categoryId: string
  source?: {
    type: 'local' | 'remote' | 'package'
    providerId?: string
  }
}

export interface StoredSceneDocument {
  id: string
  name: string
  thumbnail?: string | null
  nodes: SceneNode[]
  materials: SceneMaterial[]
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  camera: SceneCameraState
  viewportSettings: SceneViewportSettings
  groundSettings: GroundSettings
  panelVisibility?: PanelVisibilityState
  panelPlacement?: PanelPlacementState
  resourceProviderId: string
  createdAt: string
  updatedAt: string
  assetCatalog: Record<string, ProjectAsset[]>
  assetIndex: Record<string, AssetIndexEntry>
  packageAssetMap: Record<string, string>
}

export interface SceneBundle {
  formatVersion: number
  exportedAt: string
  scenes: StoredSceneDocument[]
}
