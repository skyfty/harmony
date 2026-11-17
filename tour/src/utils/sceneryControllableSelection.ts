export const SCENERY_CONTROLLABLE_TYPES = [
  'vehicle',
  'character',
  'ship',
  'aircraft',
] as const

export type SceneryControllableType = (typeof SCENERY_CONTROLLABLE_TYPES)[number]

export type StoredSceneryControllable = {
  type: SceneryControllableType
  identifier?: unknown
  prefabUrl?: unknown
  [key: string]: unknown
}

export type ResolvedSceneryControllableSelection<T extends StoredSceneryControllable> = {
  type: SceneryControllableType
  identifier: string
  selectedAsset: T | null
}

const STORED_SELECTION_FALLBACK_ORDER: SceneryControllableType[] = [
  'vehicle',
  'character',
  'ship',
  'aircraft',
]

export function normalizeSceneryControllableType(value: unknown): SceneryControllableType | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return SCENERY_CONTROLLABLE_TYPES.includes(normalized as SceneryControllableType)
    ? normalized as SceneryControllableType
    : null
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Resolve the actor selected for a scenery link.
 *
 * An explicit URL type is authoritative: it must not be replaced by a stored
 * selection of another type. An explicit URL identifier takes precedence over
 * storage, but a stored prefab is only reused when it describes the same actor.
 */
export function resolveSceneryControllableSelection<T extends StoredSceneryControllable>(params: {
  requestedType: unknown
  requestedIdentifier?: unknown
  storedSelections: Partial<Record<SceneryControllableType, T | null | undefined>>
}): ResolvedSceneryControllableSelection<T> {
  const requestedType = normalizeSceneryControllableType(params.requestedType)
  const requestedIdentifier = normalizeIdentifier(params.requestedIdentifier)

  let selectedType = requestedType
  let storedAsset: T | null = requestedType
    ? params.storedSelections[requestedType] ?? null
    : null

  if (!selectedType) {
    for (const type of STORED_SELECTION_FALLBACK_ORDER) {
      const candidate = params.storedSelections[type] ?? null
      if (candidate?.type === type) {
        selectedType = type
        storedAsset = candidate
        break
      }
    }
  }

  const storedIdentifier = normalizeIdentifier(storedAsset?.identifier)
  const identifier = requestedIdentifier || storedIdentifier
  const storedAssetMatchesRequest = Boolean(
    storedAsset
    && (
      !requestedIdentifier
      || !storedIdentifier
      || storedIdentifier === requestedIdentifier
    ),
  )

  return {
    type: selectedType ?? 'vehicle',
    identifier,
    selectedAsset: storedAssetMatchesRequest ? storedAsset : null,
  }
}
