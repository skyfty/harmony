export type SceneNodeType =
  | 'Mesh'
  | 'Light'
  | 'Group'
  | 'Camera'
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

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type SceneMaterialSide = 'front' | 'back' | 'double';

export interface SceneMaterialTextureSlotMap {
  albedo?: string | null;
  normal?: string | null;
  metalness?: string | null;
  roughness?: string | null;
  ao?: string | null;
  emissive?: string | null;
}

export interface SceneMaterial {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
  transparent?: boolean;
  opacity?: number;
  side?: SceneMaterialSide;
  wireframe?: boolean;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  aoStrength?: number;
  envMapIntensity?: number;
  textures?: SceneMaterialTextureSlotMap;
}

export interface SceneNodeMaterial {
  id: string;
  materialId: string | null;
  name?: string;
  type?: string;
  color?: string;
  transparent?: boolean;
  opacity?: number;
  side?: SceneMaterialSide;
  wireframe?: boolean;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  aoStrength?: number;
  envMapIntensity?: number;
  textures?: SceneMaterialTextureSlotMap;
}

export interface SceneNode {
  id: string;
  name: string;
  nodeType: SceneNodeType;
  position: Vector3Like;
  rotation: Vector3Like;
  scale: Vector3Like;
  visible?: boolean;
  sourceAssetId?: string;
  materials?: SceneNodeMaterial[];
  children?: SceneNode[];
}

export interface GroundSettings {
  width: number;
  depth: number;
}

export interface SceneJsonExportDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: SceneNode[];
  materials: SceneMaterial[];
  groundSettings?: GroundSettings;
  assetIndex?: Record<string, unknown>;
  packageAssetMap?: Record<string, unknown>;
}
