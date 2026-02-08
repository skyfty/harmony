import * as THREE from 'three'

export type DirectionalLightTargetHandleManager = {
  ensure(target: THREE.Object3D, options: { color: THREE.ColorRepresentation; helperSize: number }): void
  updateScreenSize(options: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null }): void
  clear(): void
}

const TARGET_HANDLE_NAME = 'HarmonyDirectionalLightTargetHandle'
// Make handle slightly smaller on-screen by default
const TARGET_HANDLE_SCREEN_DIAMETER_PX = 36

function computeWorldUnitsPerPixel(options: {
  camera: THREE.Camera
  distance: number
  viewportHeightPx: number
}): number {
  const { camera, distance, viewportHeightPx } = options
  const safeHeight = Math.max(1, viewportHeightPx)

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera
    const vFovRad = THREE.MathUtils.degToRad(perspective.fov)
    const worldHeight = 2 * Math.max(1e-6, distance) * Math.tan(vFovRad / 2)
    return worldHeight / safeHeight
  }

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera
    const worldHeight = Math.abs((ortho.top - ortho.bottom) / Math.max(1e-6, ortho.zoom))
    return worldHeight / safeHeight
  }

  return Math.max(1e-6, distance) / safeHeight
}

function createTargetHandle(options: {
  color: THREE.ColorRepresentation
  helperSize: number
}): THREE.Object3D {
  // Build a recognizable "sun" (sphere + halo ring) and keep it readable at large scales.
  // Reduce base radius so the sun handle appears smaller
  const radius = Math.max(0.12, options.helperSize * 0.08)

  const group = new THREE.Group()
  group.name = TARGET_HANDLE_NAME
  group.renderOrder = 1000
  group.layers.enableAll()

  // Base diameter used for screen-space scaling.
  const haloOuter = radius * 2.2
  group.userData = {
    ...(group.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
    baseDiameter: haloOuter * 2,
  }

  // Slight lift to avoid z-fighting with ground/meshes at the target point.
  group.position.set(0, radius * 1.2, 0)

  const sphereGeo = new THREE.SphereGeometry(radius, 18, 14)
  // Sun handle: use yellow and semi-transparent for visibility.
  const SUN_HANDLE_HEX = 0xffff00
  const sphereMat = new THREE.MeshBasicMaterial({
    color: SUN_HANDLE_HEX,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
    depthWrite: false,
  })
  sphereMat.toneMapped = false

  const sphere = new THREE.Mesh(sphereGeo, sphereMat)
  sphere.name = 'DirectionalLightTargetHandle_Sphere'
  sphere.renderOrder = 1000
  sphere.layers.enableAll()
  sphere.userData = {
    ...(sphere.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
  }
  group.add(sphere)

  const haloInner = radius * 1.45
  const haloGeo = new THREE.RingGeometry(haloInner, haloOuter, 28)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  haloMat.toneMapped = false

  const halo = new THREE.Mesh(haloGeo, haloMat)
  halo.name = 'DirectionalLightTargetHandle_Halo'
  halo.renderOrder = 999
  halo.layers.enableAll()
  halo.userData = {
    ...(halo.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
  }
  group.add(halo)

  return group
}

function refreshHandleColor(handle: THREE.Object3D, color: THREE.ColorRepresentation): void {
  handle.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const anyMaterial = (mesh as any).material as THREE.Material | THREE.Material[] | null | undefined
    const material = Array.isArray(anyMaterial) ? anyMaterial[0] : anyMaterial
    const maybeBasic = material as THREE.MeshBasicMaterial | undefined
    if (maybeBasic && (maybeBasic as any).color?.set) {
      ;(maybeBasic as any).color.set(0xffff00 as any)
    }
  })
}

export function createDirectionalLightTargetHandleManager(): DirectionalLightTargetHandleManager {
  const handles = new Set<THREE.Object3D>()

  const tmpWorld = new THREE.Vector3()
  const tmpCameraWorld = new THREE.Vector3()
  const tmpParentScale = new THREE.Vector3(1, 1, 1)

  function ensure(target: THREE.Object3D, options: { color: THREE.ColorRepresentation; helperSize: number }): void {
    const existing = target.children.find((child) =>
      child?.userData?.isDirectionalLightTargetHandle === true || child?.name === TARGET_HANDLE_NAME,
    ) as THREE.Object3D | undefined

    if (!existing) {
      const created = createTargetHandle(options)
      target.add(created)
      handles.add(created)
      return
    }

    handles.add(existing)
    refreshHandleColor(existing, options.color)
  }

  function updateScreenSize(options: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null }): void {
    if (!options.camera || !options.canvas || handles.size === 0) {
      return
    }

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)
    options.camera.getWorldPosition(tmpCameraWorld)

    for (const handle of handles) {
      if (!handle?.parent) {
        handles.delete(handle)
        continue
      }

      handle.getWorldPosition(tmpWorld)
      const distance = Math.max(1e-6, tmpWorld.distanceTo(tmpCameraWorld))
      const unitsPerPx = computeWorldUnitsPerPixel({ camera: options.camera, distance, viewportHeightPx })
      const desiredWorldDiameter = Math.max(1e-6, TARGET_HANDLE_SCREEN_DIAMETER_PX * unitsPerPx)

      const baseDiameterRaw = handle.userData?.baseDiameter
      const baseDiameter =
        typeof baseDiameterRaw === 'number' && Number.isFinite(baseDiameterRaw) && baseDiameterRaw > 1e-6
          ? baseDiameterRaw
          : 1

      const parent = handle.parent as THREE.Object3D | null
      if (parent) {
        parent.getWorldScale(tmpParentScale)
      } else {
        tmpParentScale.set(1, 1, 1)
      }

      const parentScale = Math.max(1e-6, Math.max(tmpParentScale.x, tmpParentScale.y, tmpParentScale.z))
      const scale = THREE.MathUtils.clamp(desiredWorldDiameter / (baseDiameter * parentScale), 1e-4, 1e6)
      handle.scale.setScalar(scale)

      // Keep ring facing the camera for better readability.
      handle.quaternion.copy(options.camera.quaternion)
    }
  }

  function clear(): void {
    handles.clear()
  }

  return {
    ensure,
    updateScreenSize,
    clear,
  }
}
