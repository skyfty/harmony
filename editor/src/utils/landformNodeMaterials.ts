import { generateUuid } from '@/utils/uuid'
import type {
  SceneMaterialProps,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@schema'

const LANDFORM_DEFAULT_COLOR = '#ffffff'

function buildMaterialProps(overrides?: Partial<SceneMaterialProps>): SceneMaterialProps {
  const base: SceneMaterialProps = {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'front',
    wireframe: false,
    metalness: 0.00,
    roughness: 1.0,
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
    name,
    type,
    ...buildMaterialProps(overrides),
  }
}

export function createLandformNodeMaterials(options: { color?: string; surfaceName?: string } = {}): SceneNodeMaterial[] {
  const color = options.color ?? LANDFORM_DEFAULT_COLOR
  const surfaceName = options.surfaceName ?? 'Surface'
  const surface = createNodeMaterial(surfaceName, 'MeshStandardMaterial', {
    color,
    metalness: 0.00,
    roughness: 1.0,
    transparent: false,
    opacity: 1,
    side: 'front',
  })
  return [surface]
}

export { LANDFORM_DEFAULT_COLOR }