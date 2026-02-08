import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import type { SceneNode, SceneNodeComponentState } from '@schema/index'
import { clampGuideRouteComponentProps, GUIDE_ROUTE_COMPONENT_TYPE } from '@schema/components'
import type { GuideRouteComponentProps } from '@schema/components'

// Internal cache for meshes keyed by `${nodeId}:${index}`
const guideRouteWaypointLabelMeshes = new Map<string, THREE.Mesh>()

// fontPromise will be defined below with a relaxed type to satisfy typings
let fontPromise: Promise<any> | null = null
export function loadLabelFont(): Promise<any> {
  if (fontPromise) return fontPromise
  fontPromise = new Promise<any>((resolve, reject) => {
    const loader = new FontLoader()
    // load from CDN at runtime (falls back if blocked)
    const url = 'https://unpkg.com/three@0.154.0/examples/fonts/helvetiker_regular.typeface.json'
    loader.load(url, (font) => resolve(font), undefined, (err) => reject(err))
  })
  return fontPromise
}

export function createGuideRouteWaypointLabelsManager(sceneStore: any, objectMap: Map<string, THREE.Object3D>) {
  return async function createOrUpdateGuideRouteWaypointLabels(node: SceneNode, container: THREE.Object3D) {
    try {
      if (!node || !container) return

      const tokenSnapshot = sceneStore.sceneSwitchToken

      const componentState = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as
        | SceneNodeComponentState<GuideRouteComponentProps>
        | undefined
      if (!componentState || componentState.enabled === false) {
        // Remove any existing labels for this node
        const prefix = `${node.id}:`
        for (const [key, mesh] of guideRouteWaypointLabelMeshes.entries()) {
          if (!key.startsWith(prefix)) continue
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose?.()
          mesh.removeFromParent()
          guideRouteWaypointLabelMeshes.delete(key)
        }
        return
      }

      const props = clampGuideRouteComponentProps(componentState.props as Partial<GuideRouteComponentProps> | null | undefined)
      const waypoints = Array.isArray(props.waypoints) ? props.waypoints : []

      const desiredKeys = new Set<string>()
      for (let index = 0; index < waypoints.length; index += 1) {
        desiredKeys.add(`${node.id}:${index}`)
      }

      const prefix = `${node.id}:`
      for (const [key, mesh] of guideRouteWaypointLabelMeshes.entries()) {
        if (!key.startsWith(prefix)) continue
        if (desiredKeys.has(key)) continue
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose?.()
        mesh.removeFromParent()
        guideRouteWaypointLabelMeshes.delete(key)
      }

      if (!waypoints.length) {
        return
      }

      const font = await loadLabelFont()

      // Scene switched / viewport remounted while awaiting resources.
      if (tokenSnapshot !== sceneStore.sceneSwitchToken || !sceneStore.isSceneReady) {
        return
      }

      // Node container replaced while awaiting resources (nodeId can be reused).
      if ((objectMap.get(node.id) ?? null) !== container) {
        return
      }
      const size = 0.6
      const depth = 0.06
      const yOffset = 0.22

      for (let index = 0; index < waypoints.length; index += 1) {
        const key = `${node.id}:${index}`
        const waypoint = waypoints[index]
        const rawName = typeof waypoint?.name === 'string' ? waypoint.name : ''
        const labelText = rawName.trim() || `P${index + 1}`

        const existing = guideRouteWaypointLabelMeshes.get(key)
        if (existing && existing.userData?.labelText === labelText) {
          // Update position in case waypoint moved
          const pos = waypoint?.position
          if (pos) {
            existing.position.set(Number(pos.x) || 0, (Number(pos.y) || 0) + yOffset, Number(pos.z) || 0)
          }
          continue
        }

        if (existing) {
          existing.geometry.dispose()
          ;(existing.material as THREE.Material).dispose?.()
          existing.removeFromParent()
          guideRouteWaypointLabelMeshes.delete(key)
        }

        const geom = new TextGeometry(labelText, { font, size, depth, curveSegments: 6, bevelEnabled: false })
        geom.computeBoundingBox()
        const bbox = geom.boundingBox
        if (bbox) {
          const center = new THREE.Vector3()
          bbox.getCenter(center)
          geom.translate(-center.x, -center.y, -center.z)
        }

        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
        mat.depthTest = false
        mat.toneMapped = false

        const mesh = new THREE.Mesh(geom, mat)
        mesh.name = `${node.name ?? 'GuideRoute'} waypoint ${index + 1} (label)`
        mesh.userData = { nodeId: node.id, editorOnly: true, labelText, waypointIndex: index }
        mesh.renderOrder = 9999

        const pos = waypoint?.position
        mesh.position.set(Number(pos?.x) || 0, (Number(pos?.y) || 0) + yOffset, Number(pos?.z) || 0)
        container.add(mesh)
        guideRouteWaypointLabelMeshes.set(key, mesh)
      }
    } catch (err) {
      console.warn('Failed to create guide route waypoint labels', err)
    }
  }
}

export function disposeAllGuideRouteWaypointLabels() {
  for (const [, mesh] of guideRouteWaypointLabelMeshes.entries()) {
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose?.()
    mesh.removeFromParent()
  }
  guideRouteWaypointLabelMeshes.clear()
}

export function getGuideRouteWaypointLabelMeshes() {
  return guideRouteWaypointLabelMeshes
}
