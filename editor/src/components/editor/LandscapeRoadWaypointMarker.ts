import * as THREE from 'three'

export type LandscapeRoadMarkerState = 'normal' | 'hover' | 'active'
export type LandscapeRoadMarkerKind = 'waypoint' | 'origin'

export interface LandscapeRoadWaypointMarker {
  root: THREE.Group
  setState(state: LandscapeRoadMarkerState): void
  setLabelVisible(visible: boolean): void
  setScreenHeight(worldHeight: number, parentScale?: number): void
  dispose(): void
}

const LABEL_WIDTH = 256
const LABEL_HEIGHT = 128

const COLORS: Record<LandscapeRoadMarkerKind, Record<LandscapeRoadMarkerState, number>> = {
  waypoint: {
    normal: 0xffb300,
    hover: 0x40c4ff,
    active: 0x66bb6a,
  },
  origin: {
    normal: 0x26c6da,
    hover: 0x00e5ff,
    active: 0x00c853,
  },
}

let pinGeometry: {
  ring: THREE.TorusGeometry
  stem: THREE.CylinderGeometry
  head: THREE.SphereGeometry
  hit: THREE.CylinderGeometry
} | null = null

const pinMaterials = new Map<string, THREE.MeshStandardMaterial>()
let hitMaterial: THREE.MeshBasicMaterial | null = null

function getPinGeometry(): NonNullable<typeof pinGeometry> {
  if (!pinGeometry) {
    const ring = new THREE.TorusGeometry(0.33, 0.06, 8, 30)
    ring.rotateX(Math.PI / 2)
    pinGeometry = {
      ring,
      stem: new THREE.CylinderGeometry(0.055, 0.078, 0.52, 12, 1),
      head: new THREE.SphereGeometry(0.19, 20, 14),
      hit: new THREE.CylinderGeometry(0.4, 0.4, 1.18, 12, 1, true),
    }
  }
  return pinGeometry
}

function getPinMaterial(
  kind: LandscapeRoadMarkerKind,
  state: LandscapeRoadMarkerState,
): THREE.MeshStandardMaterial {
  const key = `${kind}:${state}`
  const cached = pinMaterials.get(key)
  if (cached) {
    return cached
  }
  const color = COLORS[kind][state]
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: state === 'active' ? 0.9 : state === 'hover' ? 0.55 : 0.22,
    metalness: 0.08,
    roughness: 0.34,
    transparent: true,
    opacity: 0.97,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  material.toneMapped = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  pinMaterials.set(key, material)
  return material
}

function getHitMaterial(): THREE.MeshBasicMaterial {
  if (!hitMaterial) {
    hitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
      side: THREE.DoubleSide,
    })
    hitMaterial.toneMapped = false
  }
  return hitMaterial
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function createLabelSprite(label: string): {
  sprite: THREE.Sprite
  dispose(): void
} {
  const canvas = document.createElement('canvas')
  canvas.width = LABEL_WIDTH
  canvas.height = LABEL_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create landscape road waypoint label canvas')
  }
  context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT)
  roundedRect(context, 6, 6, LABEL_WIDTH - 12, LABEL_HEIGHT - 12, 26)
  context.fillStyle = 'rgba(15, 20, 25, 0.94)'
  context.fill()
  context.lineWidth = 5
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  context.stroke()
  context.fillStyle = '#ffffff'
  context.font = '700 58px "Segoe UI", "Microsoft YaHei", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, LABEL_WIDTH * 0.5, LABEL_HEIGHT * 0.53, LABEL_WIDTH - 28)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(0.66, 0.33, 1)
  sprite.position.y = 1.04
  sprite.renderOrder = 1004
  sprite.userData.endpointGizmoPart = 'center'
  return {
    sprite,
    dispose() {
      texture.dispose()
      material.dispose()
    },
  }
}

export function createLandscapeRoadWaypointMarker(options: {
  label: string
  kind?: LandscapeRoadMarkerKind
  showLabel?: boolean
  renderOrder?: number
}): LandscapeRoadWaypointMarker {
  const kind = options.kind ?? 'waypoint'
  const renderOrder = options.renderOrder ?? 1002
  const geometry = getPinGeometry()

  const root = new THREE.Group()
  root.name = kind === 'origin' ? 'LandscapeRoadOriginMarker' : 'LandscapeRoadWaypointMarker'
  root.userData.editorOnly = true
  root.userData.roadMarkerKind = kind

  const ring = new THREE.Mesh(geometry.ring, getPinMaterial(kind, 'normal'))
  ring.name = 'RoadMarkerGroundRing'
  ring.position.y = 0.045
  ring.renderOrder = renderOrder

  const stem = new THREE.Mesh(geometry.stem, getPinMaterial(kind, 'normal'))
  stem.name = 'RoadMarkerStem'
  stem.position.y = 0.35
  stem.renderOrder = renderOrder

  const head = new THREE.Mesh(geometry.head, getPinMaterial(kind, 'normal'))
  head.name = 'RoadMarkerHead'
  head.position.y = 0.72
  head.renderOrder = renderOrder

  const hit = new THREE.Mesh(geometry.hit, getHitMaterial())
  hit.name = 'RoadMarkerHitProxy'
  hit.position.y = 0.56
  hit.renderOrder = renderOrder - 1

  const visualMeshes = [ring, stem, head]
  for (const mesh of visualMeshes) {
    mesh.layers.enableAll()
    mesh.userData.editorOnly = true
    mesh.userData.overrideMaterial = true
    mesh.userData.endpointGizmoPart = 'center'
  }
  hit.layers.enableAll()
  hit.userData.editorOnly = true
  hit.userData.endpointGizmoPart = 'center'
  root.add(ring, stem, head, hit)

  let labelHandle: ReturnType<typeof createLabelSprite> | null = null
  let labelVisible = options.showLabel ?? true
  const ensureLabel = () => {
    if (!labelHandle) {
      labelHandle = createLabelSprite(options.label)
      labelHandle.sprite.layers.enableAll()
      labelHandle.sprite.userData.editorOnly = true
      for (const key of [
        'nodeId',
        'handleKey',
        'landscapeRoadPathVertexIndex',
        'isLandscapeRoadPathHandle',
        'isLandscapeRoadOriginMarker',
      ]) {
        if (root.userData[key] != null) {
          labelHandle.sprite.userData[key] = root.userData[key]
        }
      }
      root.add(labelHandle.sprite)
    }
    labelHandle.sprite.visible = labelVisible
    return labelHandle
  }
  if (labelVisible) {
    ensureLabel()
  }

  const marker: LandscapeRoadWaypointMarker = {
    root,
    setState(state) {
      const material = getPinMaterial(kind, state)
      for (const mesh of visualMeshes) {
        mesh.material = material
      }
    },
    setLabelVisible(visible) {
      labelVisible = visible
      if (!visible && !labelHandle) {
        return
      }
      ensureLabel().sprite.visible = visible
    },
    setScreenHeight(worldHeight, parentScale = 1) {
      const safeParentScale = Math.max(1e-6, parentScale)
      const size = Math.max(1e-4, worldHeight / safeParentScale)
      root.scale.setScalar(size)
    },
    dispose() {
      labelHandle?.dispose()
      labelHandle = null
    },
  }
  root.userData.roadMarker = marker
  return marker
}

export const LANDSCAPE_ROAD_MARKER_LABEL_LIMIT = 64
