import type { LightNodeType, SceneNodeType } from '@harmony/schema'

export const NODE_TYPE_ICONS: Record<SceneNodeType, string> = {
  Mesh: 'mdi-cube-outline',
  Light: 'mdi-lightbulb-outline',
  Group: 'mdi-cube',
  Sky: 'mdi-weather-partly-cloudy',
  Environment: 'mdi-earth',
  Camera: 'mdi-video-outline',
  Capsule: 'mdi-shape-outline',
  Circle: 'mdi-circle-outline',
  Cylinder: 'mdi-cylinder',
  Dodecahedron: 'mdi-dodecahedron',
  Icosahedron: 'mdi-icosahedron',
  Lathe: 'mdi-saw-blade',
  Octahedron: 'mdi-octahedron',
  Plane: 'mdi-vector-square',
  Ring: 'mdi-ring-outline',
  Sphere: 'mdi-sphere',
  Torus: 'mdi-torus',
  TorusKnot: 'mdi-torus-knot',
  Box: 'mdi-cube-outline',
  Empty: 'mdi-vector-point',
}

export const LIGHT_TYPE_ICONS: Record<LightNodeType, string> = {
  Directional: 'mdi-white-balance-sunny',
  Point: 'mdi-lightbulb-on-outline',
  Spot: 'mdi-spotlight-beam',
  Ambient: 'mdi-weather-night',
}

type NodeIconParams = {
  nodeType?: SceneNodeType | null
  lightType?: LightNodeType | null
  hasChildren?: boolean
  nodeId?: string | null
}

const GROUND_NODE_ID = 'harmony:ground'
const GROUND_ICON = 'mdi-grass'

export function getNodeIcon({ nodeType, lightType, hasChildren, nodeId }: NodeIconParams): string {
  if (nodeId === GROUND_NODE_ID || nodeType === 'Ground') {
    return GROUND_ICON
  }

  if (nodeType === 'Light') {
    if (lightType && lightType in LIGHT_TYPE_ICONS) {
      return LIGHT_TYPE_ICONS[lightType]
    }
    return NODE_TYPE_ICONS.Light
  }

  if (nodeType && nodeType in NODE_TYPE_ICONS) {
    return NODE_TYPE_ICONS[nodeType]
  }

  if (hasChildren) {
    return NODE_TYPE_ICONS.Group
  }

  return NODE_TYPE_ICONS.Mesh
}
