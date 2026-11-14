import type {
  HouseRigPartBinding,
  HouseRigPartLayer,
  HouseRigPartRole,
  HouseRigPartSide,
} from './types'

export interface HouseRigParsedPartName {
  role: HouseRigPartRole
  side: HouseRigPartSide | null
  layer: HouseRigPartLayer | null
}

const ROLE_ALIASES: Record<string, HouseRigPartRole> = {
  roof: 'roof',
  屋顶: 'roof',
  wall: 'wall',
  墙: 'wall',
  墙面: 'wall',
  floor: 'floor',
  地面: 'floor',
  地板: 'floor',
  foundation: 'foundation',
  地基: 'foundation',
  基础: 'foundation',
  door: 'door',
  门: 'door',
  window: 'window',
  窗: 'window',
  trim: 'trim',
  线条: 'trim',
  装饰线: 'trim',
  decoration: 'decoration',
  装饰: 'decoration',
  prop: 'decoration',
}

const SIDE_ALIASES: Record<string, HouseRigPartSide> = {
  front: 'front',
  前: 'front',
  back: 'back',
  rear: 'back',
  后: 'back',
  left: 'left',
  左: 'left',
  right: 'right',
  右: 'right',
  top: 'top',
  roof: 'top',
  上: 'top',
  bottom: 'bottom',
  下: 'bottom',
  center: 'center',
  middle: 'center',
  中: 'center',
}

const LAYER_ALIASES: Record<string, HouseRigPartLayer> = {
  inner: 'inner',
  inside: 'inner',
  interior: 'inner',
  内: 'inner',
  outer: 'outer',
  outside: 'outer',
  exterior: 'outer',
  外: 'outer',
  center: 'center',
  middle: 'center',
  中: 'center',
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function tokensFromName(name: string): string[] {
  const normalized = name.trim()
  if (!normalized) {
    return []
  }
  return normalized
    .split(/[-_.|/\\]+/u)
    .map(normalizeToken)
    .filter(Boolean)
}

function readSemanticExtra(
  extras: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!extras) {
    return ''
  }
  for (const key of keys) {
    const value = extras[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

/**
 * Resolves the stable House Rig semantics for an exported Blender object.
 *
 * Standard names and legacy Chinese aliases are both supported. glTF `extras`
 * may override the name-derived values when a designer needs an explicit tag.
 */
export function parseHouseRigPartName(
  name: string,
  extras?: Record<string, unknown> | null,
): HouseRigParsedPartName {
  const explicitRole = readSemanticExtra(extras, ['houseRigRole', 'house_rig_role', 'role'])
  const explicitSide = readSemanticExtra(extras, ['houseRigSide', 'house_rig_side', 'side'])
  const explicitLayer = readSemanticExtra(extras, ['houseRigLayer', 'house_rig_layer', 'layer'])
  const tokens = tokensFromName(name)

  let role: HouseRigPartRole = ROLE_ALIASES[normalizeToken(explicitRole)] ?? 'unknown'
  let side: HouseRigPartSide | null =
    SIDE_ALIASES[normalizeToken(explicitSide)] ?? null
  let layer: HouseRigPartLayer | null =
    LAYER_ALIASES[normalizeToken(explicitLayer)] ?? null

  // The current fixture represents its two roof planes as "墙-上-内/外".
  // Resolve that special legacy alias before the generic wall token.
  if (
    tokens.length >= 2
    && tokens[0] === '墙'
    && tokens[1] === '上'
  ) {
    role = 'roof'
    side = side ?? 'top'
  }

  for (const token of tokens) {
    if (role === 'unknown' && ROLE_ALIASES[token]) {
      role = ROLE_ALIASES[token]
    }
    if (!side && SIDE_ALIASES[token]) {
      side = SIDE_ALIASES[token]
    }
    if (!layer && LAYER_ALIASES[token]) {
      layer = LAYER_ALIASES[token]
    }
  }

  // English names often use "roof" as the side token (for example
  // roof-front-inner). Keep the semantic roof role authoritative.
  if (role === 'roof' && side === 'top') {
    side = tokens.find((token) => ['front', 'back', 'left', 'right'].includes(token))
      ? (SIDE_ALIASES[tokens.find((token) => ['front', 'back', 'left', 'right'].includes(token))!] ?? 'top')
      : side
  }

  return { role, side, layer }
}

export function objectPathFromSegments(segments: readonly number[]): string {
  return segments.length ? segments.join('.') : ''
}

export function houseRigPartKey(objectPath: string, meshName: string): string {
  const path = objectPath.trim()
  if (path) {
    return path
  }
  return meshName.trim() || 'unnamed-part'
}

export function normalizeHouseRigPartBinding(
  binding: Partial<HouseRigPartBinding>,
  fallbackName = '',
): HouseRigPartBinding {
  const meshName = typeof binding.meshName === 'string' && binding.meshName.trim()
    ? binding.meshName.trim()
    : fallbackName
  const objectPath = typeof binding.objectPath === 'string' ? binding.objectPath.trim() : ''
  return {
    key: typeof binding.key === 'string' && binding.key.trim()
      ? binding.key.trim()
      : houseRigPartKey(objectPath, meshName),
    objectPath,
    meshName,
    role: binding.role ?? 'unknown',
    side: binding.side ?? null,
    layer: binding.layer ?? null,
    material: binding.material ?? null,
  }
}
