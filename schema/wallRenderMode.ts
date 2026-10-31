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
