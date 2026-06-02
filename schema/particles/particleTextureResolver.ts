import type * as THREE from 'three'

export const PARTICLE_TEXTURE_RESOLVER_KEY = '__harmonyResolveParticleTexture'

export type ParticleTextureResolver = (assetId: string) => Promise<THREE.Texture | null>

type ParticleTextureResolverGlobal = typeof globalThis & {
  [PARTICLE_TEXTURE_RESOLVER_KEY]?: ParticleTextureResolver | null
}

export function getParticleTextureResolver(): ParticleTextureResolver | null {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as ParticleTextureResolverGlobal | undefined
  const candidate = globalObject?.[PARTICLE_TEXTURE_RESOLVER_KEY]
  return typeof candidate === 'function' ? candidate : null
}

export function setParticleTextureResolver(resolver: ParticleTextureResolver | null): void {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as ParticleTextureResolverGlobal | undefined
  if (!globalObject) {
    return
  }
  if (resolver) {
    globalObject[PARTICLE_TEXTURE_RESOLVER_KEY] = resolver
    return
  }
  delete globalObject[PARTICLE_TEXTURE_RESOLVER_KEY]
}
