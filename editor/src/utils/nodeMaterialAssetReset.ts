import {
  createTextureSettings,
  MATERIAL_TEXTURE_SLOTS,
  type SceneMaterial,
  type SceneMaterialProps,
  type SceneMaterialTextureRef,
  type SceneNodeMaterial,
} from '@/types/material'
import type { SceneMaterialTextureSlot } from '@schema/core'

/**
 * Props compared when deciding whether a node material slot still renders exactly
 * like a material asset definition, i.e. the slot was applied from that asset and
 * has not been edited since. `textures` is compared separately, and the identity
 * fields (`id` / `name` / `thumbnail` / `textureOverrides`) never take part so
 * renaming a slot does not stop the reset.
 */
const COMPARED_MATERIAL_PROP_KEYS = [
  'color',
  'transparent',
  'opacity',
  'alphaTest',
  'side',
  'wireframe',
  'metalness',
  'roughness',
  'specular',
  'shininess',
  'transmission',
  'thickness',
  'ior',
  'clearcoat',
  'clearcoatRoughness',
  'attenuationColor',
  'attenuationDistance',
  'emissive',
  'emissiveIntensity',
  'aoStrength',
  'envMapIntensity',
] as const

type ComparedMaterialPropKey = (typeof COMPARED_MATERIAL_PROP_KEYS)[number]

/**
 * Canonical defaults for props that may be missing on either side.
 *
 * Kept in sync with `DEFAULT_MATERIAL_PROPS` in `stores/sceneStore.ts`: a node
 * material slot created from a material asset receives those defaults for props
 * the asset document does not store (for example the `MeshPhysicalMaterial`
 * extras), so both sides have to be compared against the same baseline.
 */
const COMPARISON_PROP_DEFAULTS: Partial<Record<ComparedMaterialPropKey, string | number | boolean>> = {
  color: '#ffffff',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.1,
  roughness: 1,
  specular: '#111111',
  shininess: 30,
  transmission: 0,
  thickness: 0,
  ior: 1.5,
  clearcoat: 0,
  clearcoatRoughness: 0,
  attenuationColor: '#ffffff',
  attenuationDistance: 0,
  emissive: '#000000',
  emissiveIntensity: 0,
  aoStrength: 1,
  envMapIntensity: 1,
}

const NUMBER_EPSILON = 1e-6

function normalizeAssetId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numbersEqual(a: unknown, b: unknown): boolean {
  const left = typeof a === 'number' && Number.isFinite(a) ? a : null
  const right = typeof b === 'number' && Number.isFinite(b) ? b : null
  if (left === null || right === null) {
    return left === right
  }
  return Math.abs(left - right) <= NUMBER_EPSILON
}

function vectorsEqual(
  a: { x?: unknown; y?: unknown } | null | undefined,
  b: { x?: unknown; y?: unknown } | null | undefined,
): boolean {
  return numbersEqual(a?.x, b?.x) && numbersEqual(a?.y, b?.y)
}

function resolveComparablePropValue(
  props: Partial<SceneMaterialProps> | null | undefined,
  key: ComparedMaterialPropKey,
): string | number | boolean | undefined {
  const raw = (props as Record<string, unknown> | null | undefined)?.[key]
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw
  }
  return COMPARISON_PROP_DEFAULTS[key]
}

function materialPropsEqual(
  a: Partial<SceneMaterialProps> | null | undefined,
  b: Partial<SceneMaterialProps> | null | undefined,
): boolean {
  return COMPARED_MATERIAL_PROP_KEYS.every((key) => {
    const left = resolveComparablePropValue(a, key)
    const right = resolveComparablePropValue(b, key)
    if (typeof left === 'number' || typeof right === 'number') {
      return numbersEqual(left, right)
    }
    return left === right
  })
}

function textureSettingsEqual(
  a: SceneMaterialTextureRef['settings'] | null | undefined,
  b: SceneMaterialTextureRef['settings'] | null | undefined,
): boolean {
  const left = createTextureSettings(a ?? null)
  const right = createTextureSettings(b ?? null)
  return (
    left.wrapS === right.wrapS
    && left.wrapT === right.wrapT
    && left.wrapR === right.wrapR
    && vectorsEqual(left.offset, right.offset)
    && vectorsEqual(left.repeat, right.repeat)
    && vectorsEqual(left.tileSizeMeters, right.tileSizeMeters)
    && numbersEqual(left.rotation, right.rotation)
    && vectorsEqual(left.center, right.center)
    && left.matrixAutoUpdate === right.matrixAutoUpdate
    && left.generateMipmaps === right.generateMipmaps
    && left.premultiplyAlpha === right.premultiplyAlpha
    && left.flipY === right.flipY
  )
}

function textureRefsEqual(
  a: SceneMaterialTextureRef | null | undefined,
  b: SceneMaterialTextureRef | null | undefined,
): boolean {
  const left = a ?? null
  const right = b ?? null
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  if (normalizeAssetId(left.assetId) !== normalizeAssetId(right.assetId)) {
    return false
  }
  return textureSettingsEqual(left.settings ?? null, right.settings ?? null)
}

function materialTexturesEqual(
  a: Partial<SceneMaterialProps> | null | undefined,
  b: Partial<SceneMaterialProps> | null | undefined,
): boolean {
  return MATERIAL_TEXTURE_SLOTS.every((slot) => textureRefsEqual(a?.textures?.[slot], b?.textures?.[slot]))
}

/**
 * True when the slot still renders exactly like the given material asset
 * definition and was not deliberately pointed at a different material asset.
 *
 * Slots that were manually edited (props or textures changed) do not match, so
 * user edits survive the deletion of the material asset they started from.
 */
export function nodeMaterialMatchesMaterialAsset(
  entry: SceneNodeMaterial | null | undefined,
  definition: { id: string; type?: SceneMaterial['type'] } & Partial<SceneMaterialProps>,
): boolean {
  if (!entry) {
    return false
  }
  const linkedAssetId = normalizeAssetId(entry.sourceMaterialAssetId)
  if (linkedAssetId && linkedAssetId !== normalizeAssetId(definition.id)) {
    return false
  }
  // A definition without a type (legacy asset document) still matches on props.
  const definitionType = normalizeAssetId(definition.type)
  if (definitionType && normalizeAssetId(entry.type) !== definitionType) {
    return false
  }
  return materialPropsEqual(entry, definition) && materialTexturesEqual(entry, definition)
}

/** Clears the provenance link when it points at an asset that is being removed. */
export function clearDeletedMaterialAssetLink(
  entry: SceneNodeMaterial,
  deletedMaterialAssetIds: ReadonlySet<string>,
): { entry: SceneNodeMaterial; changed: boolean } {
  const linkedAssetId = normalizeAssetId(entry.sourceMaterialAssetId)
  if (!linkedAssetId || !deletedMaterialAssetIds.has(linkedAssetId)) {
    return { entry, changed: false }
  }
  const { sourceMaterialAssetId: _discarded, ...rest } = entry
  return { entry: rest as SceneNodeMaterial, changed: true }
}

export interface NodeMaterialTextureCleanupResult {
  /** `null` means the whole override entry has to be dropped. */
  entry: SceneNodeMaterial | null
  changed: boolean
}

function collectDeletedTextureSlots(
  entry: SceneNodeMaterial,
  deletedTextureAssetIds: ReadonlySet<string>,
): SceneMaterialTextureSlot[] {
  return MATERIAL_TEXTURE_SLOTS.filter((slot) => {
    const assetId = normalizeAssetId(entry.textures?.[slot]?.assetId)
    return Boolean(assetId) && deletedTextureAssetIds.has(assetId)
  })
}

/**
 * Drops references to deleted texture assets from a single node material entry.
 *
 * Regular node materials own every texture slot, so the slot is simply set to
 * `null`. Imported-model overrides work incrementally (`textureOverrides`): when
 * the entry only existed to override the deleted texture it is dropped entirely
 * so the model material / inherited state comes back, otherwise the deleted slot
 * is cleared explicitly, because an unlisted slot would keep rendering the
 * texture that was already assigned at runtime.
 *
 * `options.allowDropEntry` must only be enabled for imported-model material
 * targets: dropping an entry on any other node would leave the node without a
 * material config and keep the stale runtime material.
 */
export function clearDeletedTextureAssetsFromNodeMaterial(
  entry: SceneNodeMaterial,
  deletedTextureAssetIds: ReadonlySet<string>,
  options: { allowDropEntry?: boolean } = {},
): NodeMaterialTextureCleanupResult {
  if (!deletedTextureAssetIds.size) {
    return { entry, changed: false }
  }
  const affectedSlots = collectDeletedTextureSlots(entry, deletedTextureAssetIds)
  if (!affectedSlots.length) {
    return { entry, changed: false }
  }

  const declaredSlots = Array.isArray(entry.textureOverrides) ? entry.textureOverrides : null
  const allowDropEntry = options.allowDropEntry ?? true
  if (!declaredSlots || !allowDropEntry) {
    const textures = { ...(entry.textures ?? {}) }
    affectedSlots.forEach((slot) => {
      textures[slot] = null
    })
    return { entry: { ...entry, textures }, changed: true }
  }

  // Only drop the override when no texture reference survives anywhere in the
  // entry; a slot the entry does not list (legacy / preset data) must not be lost.
  const survivingTextureSlots = MATERIAL_TEXTURE_SLOTS.filter(
    (slot) => !affectedSlots.includes(slot) && Boolean(entry.textures?.[slot]),
  )
  if (!survivingTextureSlots.length) {
    // The override only carried the deleted texture(s): drop it so the node falls
    // back to the model's own material instead of keeping a blank override.
    return { entry: null, changed: true }
  }

  const textures = { ...(entry.textures ?? {}) }
  affectedSlots.forEach((slot) => {
    textures[slot] = null
  })
  return {
    entry: {
      ...entry,
      textures,
      textureOverrides: Array.from(new Set([...declaredSlots, ...affectedSlots])),
    },
    changed: true,
  }
}
