import type { SceneNodeMaterial, Vector3Like } from '../core'

export const HOUSE_RIG_SCHEMA_VERSION = 1
export const HOUSE_RIG_COMPONENT_TYPE = 'houseRig'
export const HOUSE_RIG_DEFAULT_SCRIPT_ID = 'basic-naming'
export const HOUSE_RIG_DEFAULT_SCRIPT_VERSION = '1.0.0'
export const HOUSE_RIG_DEFAULT_MIN_SCALE = 0.35

export type HouseRigDimensionKey = 'width' | 'depth' | 'wallHeight'
export type HouseRigAxis = 'x' | 'y' | 'z'

export interface HouseRigDimensions {
  width: number
  depth: number
  wallHeight: number
}

export interface HouseRigDimensionLimits {
  width: { min: number; max: number | null; step: number }
  depth: { min: number; max: number | null; step: number }
  wallHeight: { min: number; max: number | null; step: number }
}

export type HouseRigPartRole =
  | 'roof'
  | 'wall'
  | 'floor'
  | 'foundation'
  | 'door'
  | 'window'
  | 'trim'
  | 'decoration'
  | 'unknown'

export type HouseRigPartSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'center'
export type HouseRigPartLayer = 'inner' | 'outer' | 'center'

export interface HouseRigPartBinding {
  key: string
  objectPath: string
  meshName: string
  role: HouseRigPartRole
  side: HouseRigPartSide | null
  layer: HouseRigPartLayer | null
  material: SceneNodeMaterial | null
}

export interface HouseRigComponentProps {
  schemaVersion: typeof HOUSE_RIG_SCHEMA_VERSION
  scriptId: string
  scriptVersion: string
  assetId: string | null
  topologyHash: string | null
  restDimensions: HouseRigDimensions
  dimensions: HouseRigDimensions
  parts: HouseRigPartBinding[]
  migratedFromPrototype?: boolean
}

export interface HouseRigPartBounds {
  min: Vector3Like
  max: Vector3Like
  center: Vector3Like
  size: Vector3Like
}

export interface HouseRigRestPart {
  key: string
  objectPath: string
  meshName: string
  role: HouseRigPartRole
  side: HouseRigPartSide | null
  layer: HouseRigPartLayer | null
  vertexCount: number
  positionsRoot: Float32Array
  uvs: Float32Array | null
  bounds: HouseRigPartBounds
}

export interface HouseRigRestSnapshot {
  assetId: string | null
  topologyHash: string
  dimensions: HouseRigDimensions
  limits: HouseRigDimensionLimits
  bounds: HouseRigPartBounds
  parts: HouseRigRestPart[]
  warnings: string[]
}

export interface HouseRigAssetDescriptor {
  assetId: string | null
  topologyHash: string
  dimensions: HouseRigDimensions
  parts: Array<{
    key: string
    objectPath: string
    meshName: string
    role: HouseRigPartRole
    side: HouseRigPartSide | null
    layer: HouseRigPartLayer | null
    vertexCount: number
  }>
}

export interface HouseRigCompatibility {
  compatible: boolean
  issues: string[]
}

export interface HouseRigHandles {
  width: Vector3Like
  depth: Vector3Like
  wallHeight: Vector3Like
}

export interface HouseRigDeformPlanPart {
  key: string
  positionsRoot: ArrayLike<number>
  uvs?: ArrayLike<number> | null
}

export interface HouseRigDeformPlan {
  parts: HouseRigDeformPlanPart[]
  handles: HouseRigHandles
  bounds: HouseRigPartBounds
  warnings: string[]
}

export interface HouseRigScript {
  id: string
  label: string
  version: string
  description: string
  requiredParts: string[]
  getCompatibility(asset: HouseRigAssetDescriptor): HouseRigCompatibility
  buildPlan(rest: HouseRigRestSnapshot, dimensions: HouseRigDimensions): HouseRigDeformPlan
}

export interface HouseRigRuntimeSnapshot {
  nodeId: string
  componentId: string
  rest: HouseRigRestSnapshot
  dimensions: HouseRigDimensions
  plan: HouseRigDeformPlan | null
  scriptId: string
  scriptVersion: string
  compatibility: HouseRigCompatibility | null
  warnings: string[]
}
