import type { LightNodeType, SceneNodeType } from './scene'

export const NODE_TYPE_ICONS: Record<SceneNodeType, string> = {
  Mesh: 'mdi-cube-outline',
  Light: 'mdi-lightbulb-outline',
  Group: 'mdi-folder-outline',
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
