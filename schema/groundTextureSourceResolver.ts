export const GROUND_TEXTURE_SOURCE_RESOLVER_KEY = '__harmonyResolveGroundTextureSource'

export type GroundTextureSourceResolver = (source: string) => string | null

type GroundTextureSourceResolverGlobal = typeof globalThis & {
  [GROUND_TEXTURE_SOURCE_RESOLVER_KEY]?: GroundTextureSourceResolver | null
}

export function getGroundTextureSourceResolver(): GroundTextureSourceResolver | null {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as GroundTextureSourceResolverGlobal | undefined
  const candidate = globalObject?.[GROUND_TEXTURE_SOURCE_RESOLVER_KEY]
  return typeof candidate === 'function' ? candidate : null
}

export function setGroundTextureSourceResolver(resolver: GroundTextureSourceResolver | null): void {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as GroundTextureSourceResolverGlobal | undefined
  if (!globalObject) {
    return
  }
  if (resolver) {
    globalObject[GROUND_TEXTURE_SOURCE_RESOLVER_KEY] = resolver
    return
  }
  delete globalObject[GROUND_TEXTURE_SOURCE_RESOLVER_KEY]
}