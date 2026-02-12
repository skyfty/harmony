import { generateUuid } from '@/utils/uuid'
import type {
  SceneMaterialProps,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@harmony/schema'

const FLOOR_DEFAULT_COLOR = '#4b4f55'

function buildMaterialProps(overrides?: Partial<SceneMaterialProps>): SceneMaterialProps {
  const base: SceneMaterialProps = {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    side: 'double',
    wireframe: false,
    metalness: 0.1,
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
    materialId: null,
    name,
    type,
    ...buildMaterialProps(overrides),
  }
}

export function createFloorNodeMaterials(options: {
  color?: string
  topBottomName?: string
  sideName?: string
} = {}): SceneNodeMaterial[] {
  const color = options.color ?? FLOOR_DEFAULT_COLOR
  const topBottomName = options.topBottomName ?? 'TopBottom'
  const sideName = options.sideName ?? 'Side'

  const baseProps: Partial<SceneMaterialProps> = {
    color,
    metalness: 0.05,
    roughness: 0.85,
    side: 'double',
  }

  const topBottom = createNodeMaterial(topBottomName, 'MeshStandardMaterial', baseProps)
  // Side defaults to the same material props (user can customize later).
  const side = createNodeMaterial(sideName, topBottom.type, baseProps)

  return [topBottom, side]
}

export { FLOOR_DEFAULT_COLOR }
