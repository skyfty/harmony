export const PROCEDURAL_LANDSCAPE_ASSET_RESOLVER_KEY = '__harmonyResolveProceduralLandscapeAssetSource'

export type ProceduralLandscapeAssetResolver = (assetId: string) => string | null | Promise<string | null>

type ResolverGlobal = typeof globalThis & {
  [PROCEDURAL_LANDSCAPE_ASSET_RESOLVER_KEY]?: ProceduralLandscapeAssetResolver | null
}

export function getProceduralLandscapeAssetResolver(): ProceduralLandscapeAssetResolver | null {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : undefined) as ResolverGlobal | undefined
  const candidate = globalObject?.[PROCEDURAL_LANDSCAPE_ASSET_RESOLVER_KEY]
  return typeof candidate === 'function' ? candidate : null
}

export function setProceduralLandscapeAssetResolver(resolver: ProceduralLandscapeAssetResolver | null): void {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : undefined) as ResolverGlobal | undefined
  if (!globalObject) {
    return
  }
  if (resolver) {
    globalObject[PROCEDURAL_LANDSCAPE_ASSET_RESOLVER_KEY] = resolver
    return
  }
  delete globalObject[PROCEDURAL_LANDSCAPE_ASSET_RESOLVER_KEY]
}
