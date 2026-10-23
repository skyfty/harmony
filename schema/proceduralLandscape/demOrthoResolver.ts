export interface ProceduralLandscapeDemOrthoTexture {
  width: number
  height: number
  /** Opaque RGB rows stored south-to-north, columns west-to-east. */
  rgb: Uint8Array
  sourceBytes: number
  sourceKey: string
}

export interface ProceduralLandscapeDemOrthoResolver {
  canResolve(assetId: string): boolean
  load(assetId: string): Promise<ProceduralLandscapeDemOrthoTexture>
}

const RESOLVER_KEY = '__harmonyProceduralLandscapeDemOrthoResolver'

type ResolverGlobal = typeof globalThis & {
  [RESOLVER_KEY]?: ProceduralLandscapeDemOrthoResolver | null
}

export function getProceduralLandscapeDemOrthoResolver(): ProceduralLandscapeDemOrthoResolver | null {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : undefined) as ResolverGlobal | undefined
  return globalObject?.[RESOLVER_KEY] ?? null
}

export function setProceduralLandscapeDemOrthoResolver(
  resolver: ProceduralLandscapeDemOrthoResolver | null,
): void {
  const globalObject = (typeof globalThis !== 'undefined' ? globalThis : undefined) as ResolverGlobal | undefined
  if (!globalObject) {
    return
  }
  if (resolver) {
    globalObject[RESOLVER_KEY] = resolver
  } else {
    delete globalObject[RESOLVER_KEY]
  }
}
