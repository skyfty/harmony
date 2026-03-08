import { generateUuid } from '@/utils/uuid'
import type {
  SceneMaterialProps,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@schema'

const WALL_DEFAULT_COLOR = '#cfd2d6'

function buildMaterialProps(overrides?: Partial<SceneMaterialProps>): SceneMaterialProps {
  const base: SceneMaterialProps = {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'double',
    wireframe: false,
    metalness: 0,
    roughness: 0.92,
    emissive: '#000000',
    emissiveIntensity: 0,
    aoStrength: 1,
    envMapIntensity: 1,
    textures: {},
  }
  const textures: SceneMaterialTextureSlotMap = overrides?.textures ? { ...overrides.textures } : {}
  return {
    ...base,
    ...overrides,
    textures,
  }
}

function createNodeMaterial(name: string, type: SceneMaterialType, overrides?: Partial<SceneMaterialProps>): SceneNodeMaterial {
  return {
    id: generateUuid(),
    materialId: null,
    name,
    type,
    ...buildMaterialProps(overrides),
  }
}

export function createWallNodeMaterials(options: {
  color?: string
  bodyName?: string
} = {}): SceneNodeMaterial[] {
  const color = options.color ?? WALL_DEFAULT_COLOR
  const bodyName = options.bodyName ?? 'Body'

  return [
    createNodeMaterial(bodyName, 'MeshStandardMaterial', {
      color,
      metalness: 0,
      roughness: 0.92,
      side: 'double',
    }),
  ]
}

export { WALL_DEFAULT_COLOR }