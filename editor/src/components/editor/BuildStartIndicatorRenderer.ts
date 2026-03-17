import * as THREE from 'three'

export type BuildStartIndicatorRenderer = {
  showAt: (point: THREE.Vector3, options?: { height?: number | null }) => void
  hide: () => void
  dispose: () => void
}

const INDICATOR_COLOR = 0xffa726
const INDICATOR_TIP_Y_OFFSET = 0.004
const INDICATOR_DEFAULT_HEIGHT = 2

const SHAFT_LENGTH = 0.62
const SHAFT_RADIUS = 0.06
const CONE_LENGTH = 0.38
const CONE_RADIUS = 0.18
const INDICATOR_TOTAL_HEIGHT = SHAFT_LENGTH + CONE_LENGTH

function normalizeIndicatorHeight(height: number | null | undefined): number {
  if (typeof height !== 'number' || !isFinite(height) || height <= 0) {
    return INDICATOR_DEFAULT_HEIGHT
  }
  return Math.max(0.25, height)
}

function computeWidthScale(height: number): number {
  return Math.max(1, Math.min(2.4, 1 + (height - 1) * 0.2))
}

function createIndicatorMesh(): {
  root: THREE.Group
  dispose: () => void
} {
  const root = new THREE.Group()
  root.name = 'BuildStartIndicator'
  root.visible = false

  const shaftGeometry = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 16)
  const coneGeometry = new THREE.ConeGeometry(CONE_RADIUS, CONE_LENGTH, 24)
  const material = new THREE.MeshBasicMaterial({
    color: INDICATOR_COLOR,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  })

  const shaft = new THREE.Mesh(shaftGeometry, material)
  shaft.name = 'BuildStartIndicator_Shaft'
  shaft.position.set(0, CONE_LENGTH + SHAFT_LENGTH * 0.5, 0)

  const cone = new THREE.Mesh(coneGeometry, material)
  cone.name = 'BuildStartIndicator_Cone'
  cone.rotation.x = Math.PI
  cone.position.set(0, CONE_LENGTH * 0.5, 0)

  root.add(shaft)
  root.add(cone)

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    mesh.layers.enableAll()
    mesh.renderOrder = 998
  })

  return {
    root,
    dispose: () => {
      shaftGeometry.dispose()
      coneGeometry.dispose()
      material.dispose()
    },
  }
}

export function createBuildStartIndicatorRenderer(options: {
  rootGroup: THREE.Group
}): BuildStartIndicatorRenderer {
  const indicator = createIndicatorMesh()
  options.rootGroup.add(indicator.root)

  return {
    showAt: (point: THREE.Vector3, showOptions?: { height?: number | null }) => {
      const resolvedHeight = normalizeIndicatorHeight(showOptions?.height)
      const widthScale = computeWidthScale(resolvedHeight)
      indicator.root.visible = true
      indicator.root.position.copy(point)
      indicator.root.position.y += INDICATOR_TIP_Y_OFFSET
      indicator.root.scale.set(
        widthScale,
        resolvedHeight / INDICATOR_TOTAL_HEIGHT,
        widthScale,
      )
    },
    hide: () => {
      indicator.root.visible = false
    },
    dispose: () => {
      indicator.root.removeFromParent()
      indicator.dispose()
    },
  }
}
