import type { LightNodeType, SceneNodeType } from './scene'

export const NODE_TYPE_ICONS: Record<SceneNodeType, string> = {
  mesh: 'mdi-cube-outline',
  light: 'mdi-lightbulb-outline',
  group: 'mdi-folder-outline',
}

export const LIGHT_TYPE_ICONS: Record<LightNodeType, string> = {
  directional: 'mdi-white-balance-sunny',
  point: 'mdi-lightbulb-on-outline',
  spot: 'mdi-spotlight-beam',
  ambient: 'mdi-weather-night',
}

type NodeIconParams = {
  nodeType?: SceneNodeType | null
  lightType?: LightNodeType | null
  hasChildren?: boolean
}

export function getNodeIcon({ nodeType, lightType, hasChildren }: NodeIconParams): string {
  if (nodeType === 'light') {
    if (lightType && lightType in LIGHT_TYPE_ICONS) {
      return LIGHT_TYPE_ICONS[lightType]
    }
    return NODE_TYPE_ICONS.light
  }

  if (nodeType && nodeType in NODE_TYPE_ICONS) {
    return NODE_TYPE_ICONS[nodeType]
  }

  if (hasChildren) {
    return NODE_TYPE_ICONS.group
  }

  return NODE_TYPE_ICONS.mesh
}
