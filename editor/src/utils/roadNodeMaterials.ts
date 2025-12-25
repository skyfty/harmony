import { generateUuid } from '@/utils/uuid'
import type {
  SceneMaterialProps,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@harmony/schema'

const ROAD_SURFACE_DEFAULT_COLOR = '#4b4f55'
const ROAD_SHOULDER_DEFAULT_COLOR = '#ffffff'
const ROAD_LANE_LINE_DEFAULT_COLOR = '#ffff00'

function buildMaterialName(base: string, label?: string | null): string {
  const trimmed = label?.trim()
  return trimmed ? `${trimmed} ${base}` : base
}

function buildRoadMaterialProps(overrides?: Partial<SceneMaterialProps>): SceneMaterialProps {
  const base: SceneMaterialProps = {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'double',
    wireframe: false,
    metalness: 0.5,
    roughness: 0.5,
    emissive: '#000000',
    emissiveIntensity: 0,
    aoStrength: 1,
    envMapIntensity: 1,
    textures: {}
  }
  const textures: SceneMaterialTextureSlotMap = overrides?.textures ? { ...overrides.textures } : {}
  return {
    ...base,
    ...overrides,
    textures,
  }
}

function createRoadNodeMaterial(name: string, type: SceneMaterialType, overrides?: Partial<SceneMaterialProps>): SceneNodeMaterial {
  return {
    id: generateUuid(),
    materialId: null,
    name,
    type,
    ...buildRoadMaterialProps(overrides),
  }
}

export function createRoadNodeMaterials(surfaceColor = ROAD_SURFACE_DEFAULT_COLOR, layerName?: string | null): SceneNodeMaterial[] {
  const prefix = (label: string) => buildMaterialName(label, layerName)
  return [
    createRoadNodeMaterial(prefix('Road Surface Material'), 'MeshStandardMaterial', {
      color: surfaceColor,
      metalness: 0.05,
      roughness: 0.85,
    }),
    createRoadNodeMaterial(prefix('Road Shoulder Material'), 'MeshStandardMaterial', {
      color: ROAD_SHOULDER_DEFAULT_COLOR,
      transparent: true,
      opacity: 0.85,
      metalness: 0,
      roughness: 0.9,
    }),
    createRoadNodeMaterial(prefix('Road Lane Line Material'), 'MeshBasicMaterial', {
      color: ROAD_LANE_LINE_DEFAULT_COLOR,
      transparent: true,
      opacity: 0.9,
    }),
  ]
}

export { ROAD_SURFACE_DEFAULT_COLOR, ROAD_SHOULDER_DEFAULT_COLOR, ROAD_LANE_LINE_DEFAULT_COLOR }
