export type WallRenderMode = 'stretch' | 'repeatInstances' | 'texture'

export function normalizeWallRenderMode(
  value: unknown,
  fallback: WallRenderMode = 'stretch',
): WallRenderMode {
  if (value === 'stretch' || value === 'repeatInstances' || value === 'texture') {
    return value
  }
  return fallback
}

type TextureWallMaterialNode = {
  dynamicMesh?: { type?: string } | null
  components?: Record<string, {
    enabled?: boolean
    props?: { wallRenderMode?: unknown } | null
  } | undefined> | null
}

/**
 * Texture walls own alpha-tested image materials after the wall graph is built.
 * Runtime hosts must not replace them with generic node material overrides.
 */
export function shouldPreserveTextureWallNodeMaterials(
  node: TextureWallMaterialNode | null | undefined,
): boolean {
  if (!node || node.dynamicMesh?.type !== 'Wall') {
    return false
  }
  const wallState = node.components?.wall
  if (!wallState || wallState.enabled === false) {
    return false
  }
  return normalizeWallRenderMode(wallState.props?.wallRenderMode) === 'texture'
}
