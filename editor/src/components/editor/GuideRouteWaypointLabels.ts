import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import { clampGuideRouteComponentProps, GUIDE_ROUTE_COMPONENT_TYPE } from '@schema/components'
import type { GuideRouteComponentProps } from '@schema/components'

// Internal cache for meshes keyed by `${nodeId}:${index}`
const guideRouteWaypointLabelMeshes = new Map<string, THREE.Mesh>()
const LABEL_RENDERER_ID = 'canvas-v1'
const LABEL_FONT_SIZE_PX = 64
const LABEL_MIN_FONT_SIZE_PX = 18
const LABEL_MAX_CANVAS_WIDTH_PX = 2048
const LABEL_PIXELS_PER_WORLD_UNIT = 128
const LABEL_FONT_FAMILY = [
  '"Microsoft YaHei"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Noto Sans CJK SC"',
  '"Noto Sans SC"',
  '"Source Han Sans SC"',
  '"WenQuanYi Micro Hei"',
  'Arial',
  'sans-serif',
].join(', ')

function measureLabelText(
  context: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
): number {
  context.font = `700 ${fontSize}px ${LABEL_FONT_FAMILY}`
  return context.measureText(text).width
}

function resolveFittedLabelText(
  context: CanvasRenderingContext2D,
  text: string,
  availableWidth: number,
): { text: string; fontSize: number } {
  let fontSize = LABEL_FONT_SIZE_PX
  let textWidth = measureLabelText(context, text, fontSize)
  if (textWidth > availableWidth) {
    fontSize = Math.max(
      LABEL_MIN_FONT_SIZE_PX,
      Math.floor(fontSize * availableWidth / textWidth),
    )
    textWidth = measureLabelText(context, text, fontSize)
  }
  if (textWidth <= availableWidth) {
    return { text, fontSize }
  }

  const characters = Array.from(text)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = `${characters.slice(0, middle).join('')}…`
    if (measureLabelText(context, candidate, fontSize) <= availableWidth) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return {
    text: `${characters.slice(0, Math.max(1, low)).join('')}…`,
    fontSize,
  }
}

export function createGuideRouteWaypointLabelTexture(labelText: string): {
  texture: THREE.CanvasTexture
  worldWidth: number
  worldHeight: number
} {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D is unavailable for Guide Route labels.')
  }

  const maxTextWidth = LABEL_MAX_CANVAS_WIDTH_PX - 32
  const fitted = resolveFittedLabelText(context, labelText, maxTextWidth)
  const padding = Math.max(8, Math.ceil(fitted.fontSize * 0.2))
  const textWidth = Math.ceil(measureLabelText(context, fitted.text, fitted.fontSize))
  canvas.width = Math.max(1, textWidth + padding * 2)
  canvas.height = Math.max(1, Math.ceil(fitted.fontSize * 1.35))

  context.font = `700 ${fitted.fontSize}px ${LABEL_FONT_FAMILY}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(3, fitted.fontSize * 0.1)
  context.strokeStyle = 'rgba(0, 0, 0, 0.92)'
  context.fillStyle = '#ffffff'
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  context.strokeText(fitted.text, centerX, centerY)
  context.fillText(fitted.text, centerX, centerY)

  const texture = new THREE.CanvasTexture(canvas)
  texture.name = `GuideRouteWaypointLabel:${labelText}`
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return {
    texture,
    worldWidth: canvas.width / LABEL_PIXELS_PER_WORLD_UNIT,
    worldHeight: canvas.height / LABEL_PIXELS_PER_WORLD_UNIT,
  }
}

function disposeGuideRouteWaypointLabelMesh(mesh: THREE.Mesh): void {
  mesh.removeFromParent()
  mesh.geometry.dispose()
  const material = mesh.material as THREE.MeshBasicMaterial
  material.map?.dispose()
  material.dispose()
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
          disposeGuideRouteWaypointLabelMesh(mesh)
          guideRouteWaypointLabelMeshes.delete(key)
        }
        return
      }

      const props = clampGuideRouteComponentProps(componentState.props as Partial<GuideRouteComponentProps> | null | undefined)
      const waypoints = Array.isArray(props.stops) ? props.stops : []

      const desiredKeys = new Set<string>()
      for (let index = 0; index < waypoints.length; index += 1) {
        desiredKeys.add(`${node.id}:${index}`)
      }

      const prefix = `${node.id}:`
      for (const [key, mesh] of guideRouteWaypointLabelMeshes.entries()) {
        if (!key.startsWith(prefix)) continue
        if (desiredKeys.has(key)) continue
        disposeGuideRouteWaypointLabelMesh(mesh)
        guideRouteWaypointLabelMeshes.delete(key)
      }

      if (!waypoints.length) {
        return
      }

      if (tokenSnapshot !== sceneStore.sceneSwitchToken || !sceneStore.isSceneReady) {
        return
      }

      if ((objectMap.get(node.id) ?? null) !== container) {
        return
      }
      const yOffset = 0.22
      container.updateMatrixWorld(true)

      for (let index = 0; index < waypoints.length; index += 1) {
        const key = `${node.id}:${index}`
        const waypoint = waypoints[index]
        const rawName = typeof waypoint?.name === 'string' ? waypoint.name : ''
        const labelText = rawName.trim() || `P${index + 1}`

        const existing = guideRouteWaypointLabelMeshes.get(key)
        if (
          existing
          && existing.userData?.labelText === labelText
          && existing.userData?.labelRenderer === LABEL_RENDERER_ID
        ) {
          // Update position in case waypoint moved
          const pos = waypoint?.anchor
          if (pos) {
            const local = container.worldToLocal(new THREE.Vector3(
              Number(pos.x) || 0,
              Number(pos.y) || 0,
              Number(pos.z) || 0,
            ))
            existing.position.set(local.x, local.y + yOffset, local.z)
          }
          continue
        }

        if (existing) {
          disposeGuideRouteWaypointLabelMesh(existing)
          guideRouteWaypointLabelMeshes.delete(key)
        }

        const { texture, worldWidth, worldHeight } = createGuideRouteWaypointLabelTexture(labelText)
        const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight)
        const material = new THREE.MeshBasicMaterial({
          color: 0xffeb3b,
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `${node.name ?? 'GuideRoute'} waypoint ${index + 1} (label)`
        mesh.userData = {
          nodeId: node.id,
          editorOnly: true,
          labelText,
          labelRenderer: LABEL_RENDERER_ID,
          waypointIndex: index,
        }
        mesh.renderOrder = 9999
        mesh.frustumCulled = false

        const pos = waypoint?.anchor
        const local = container.worldToLocal(new THREE.Vector3(
          Number(pos?.x) || 0,
          Number(pos?.y) || 0,
          Number(pos?.z) || 0,
        ))
        mesh.position.set(local.x, local.y + yOffset, local.z)
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
    disposeGuideRouteWaypointLabelMesh(mesh)
  }
  guideRouteWaypointLabelMeshes.clear()
}

export function getGuideRouteWaypointLabelMeshes() {
  return guideRouteWaypointLabelMeshes
}
