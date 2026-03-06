const BUILTIN_SCHEME_PREFIX = 'builtin://'

export const BUILTIN_WATER_NORMAL_ASSET_ID = 'builtin://waternormal.jpg'

const BUILTIN_CANONICAL_IDS = [
  BUILTIN_WATER_NORMAL_ASSET_ID,
] as const

const BUILTIN_ALIAS_MAP: Record<string, string[]> = {
  [BUILTIN_WATER_NORMAL_ASSET_ID]: [
    'builtin://waternormal.jpg',
    'builtin:/waternormal.jpg',
    'builtin/waternormal.jpg',
    '/builtin/waternormal.jpg',
    'assets/builtin/waternormal.jpg',
    'resources/waternormal.jpg',
    'waternormal.jpg',
  ],
}

function normalizeLookupKey(value: string): string {
  let normalized = value.trim().replace(/\\/g, '/').toLowerCase()
  const queryIndex = normalized.indexOf('?')
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex)
  }
  const hashIndex = normalized.indexOf('#')
  if (hashIndex >= 0) {
    normalized = normalized.slice(0, hashIndex)
  }
  normalized = normalized.replace(/^\.\//, '')
  return normalized
}

const LOOKUP_TO_CANONICAL = (() => {
  const map = new Map<string, string>()

  BUILTIN_CANONICAL_IDS.forEach((canonical) => {
    map.set(normalizeLookupKey(canonical), canonical)
    const aliases = BUILTIN_ALIAS_MAP[canonical] ?? []
    aliases.forEach((alias) => {
      map.set(normalizeLookupKey(alias), canonical)
    })
  })

  return map
})()

export function resolveBuiltinCanonicalAssetId(assetId: string | null | undefined): string | null {
  if (typeof assetId !== 'string') {
    return null
  }
  const normalized = normalizeLookupKey(assetId)
  if (!normalized.length) {
    return null
  }
  return LOOKUP_TO_CANONICAL.get(normalized) ?? null
}

export function collectBuiltinAssetLookupIds(assetId: string | null | undefined): string[] {
  const id = typeof assetId === 'string' ? assetId.trim() : ''
  if (!id.length) {
    return []
  }
  const result = new Set<string>()
  result.add(id)

  const canonical = resolveBuiltinCanonicalAssetId(id)
  if (canonical) {
    result.add(canonical)
  }

  if (id.startsWith(BUILTIN_SCHEME_PREFIX)) {
    const name = id.slice(BUILTIN_SCHEME_PREFIX.length).trim()
    if (name.length) {
      result.add(name)
      result.add(`/builtin/${name}`)
      result.add(`builtin/${name}`)
      result.add(`assets/builtin/${name}`)
      result.add(`resources/${name}`)
    }
  }

  return Array.from(result)
}