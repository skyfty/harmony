import * as THREE from 'three'

export type DirectionalLightTargetHandleManager = {
  ensure(
    target: THREE.Object3D,
    options: { color: THREE.ColorRepresentation; helperSize: number; direction?: THREE.Vector3 },
  ): void
  updateScreenSize(options: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null }): void
  clear(): void
}

const TARGET_HANDLE_NAME = 'HarmonyDirectionalLightTargetHandle'
const TARGET_HANDLE_SCREEN_DIAMETER_PX = 28
const BILLBOARD_GROUP_NAME = 'DirectionalLightTargetHandle_Billboard'
const DIRECTION_GROUP_NAME = 'DirectionalLightTargetHandle_Direction'

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
  direction?: THREE.Vector3
}): THREE.Object3D {
  // Build a recognizable "sun" (sphere + halo ring) and keep it readable at large scales.
  // Reduce the minimum radius and scale factor so the on-screen handle appears smaller.
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
    billboardGroupName: BILLBOARD_GROUP_NAME,
    directionGroupName: DIRECTION_GROUP_NAME,
    direction: options.direction ? options.direction.clone() : null,
  }

  // Slight lift to avoid z-fighting with ground/meshes at the target point.
  group.position.set(0, radius * 1.2, 0)

  // Billboarded visuals (sphere + halo) should face the camera.
  const billboardGroup = new THREE.Group()
  billboardGroup.name = BILLBOARD_GROUP_NAME
  billboardGroup.renderOrder = 1000
  billboardGroup.layers.enableAll()
  billboardGroup.userData = {
    ...(billboardGroup.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
    isDirectionalLightTargetHandleBillboard: true,
  }
  group.add(billboardGroup)

  const sphereGeo = new THREE.SphereGeometry(radius, 18, 14)
  const sphereMat = new THREE.MeshBasicMaterial({
    color: options.color,
    transparent: true,
    // Make the central sphere semi-transparent so it doesn't visually dominate the scene.
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
  billboardGroup.add(sphere)

  const haloInner = radius * 1.45
  const haloGeo = new THREE.RingGeometry(haloInner, haloOuter, 28)
  const haloMat = new THREE.MeshBasicMaterial({
    color: options.color,
    transparent: true,
    // Slightly more transparent halo for a subtle visual effect.
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
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
  billboardGroup.add(halo)

  // Direction rays (Unity-like) should reflect the light direction, not face the camera.
  const directionGroup = new THREE.Group()
  directionGroup.name = DIRECTION_GROUP_NAME
  directionGroup.renderOrder = 998
  directionGroup.layers.enableAll()
  directionGroup.userData = {
    ...(directionGroup.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
    isDirectionalLightTargetHandleDirection: true,
  }

  const rayLength = radius * 3.0
  const rayOffset = radius * 0.65
  const raySpread = radius * 0.55

  // Rays are authored along -Z (forward). We'll rotate the group so -Z points at the desired direction.
  const positions = new Float32Array([
    // center ray
    0,
    0,
    0,
    0,
    0,
    -rayLength,

    // upper ray
    0,
    rayOffset,
    raySpread,
    0,
    rayOffset,
    raySpread - rayLength,

    // lower ray
    0,
    -rayOffset,
    -raySpread,
    0,
    -rayOffset,
    -raySpread - rayLength,
  ])
  const rayGeo = new THREE.BufferGeometry()
  rayGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const rayMat = new THREE.LineBasicMaterial({
    color: options.color,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
  })
  ;(rayMat as any).toneMapped = false

  const rays = new THREE.LineSegments(rayGeo, rayMat)
  rays.name = 'DirectionalLightTargetHandle_Rays'
  rays.renderOrder = 998
  rays.layers.enableAll()
  rays.userData = {
    ...(rays.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
  }
  directionGroup.add(rays)
  group.add(directionGroup)

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
      ;(maybeBasic as any).color.set(color as any)
    }
  })
}

export function createDirectionalLightTargetHandleManager(): DirectionalLightTargetHandleManager {
  const handles = new Set<THREE.Object3D>()

  const tmpWorld = new THREE.Vector3()
  const tmpCameraWorld = new THREE.Vector3()
  const tmpParentScale = new THREE.Vector3(1, 1, 1)

  const tmpQuat = new THREE.Quaternion()
  const tmpDir = new THREE.Vector3()
  const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1)

  function ensure(
    target: THREE.Object3D,
    options: { color: THREE.ColorRepresentation; helperSize: number; direction?: THREE.Vector3 },
  ): void {
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

    if (options.direction && options.direction.isVector3) {
      ;(existing.userData as any).direction = options.direction.clone()
    }
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

      const billboardName = handle.userData?.billboardGroupName as string | undefined
      const billboard = handle.getObjectByName(billboardName ?? BILLBOARD_GROUP_NAME)
      if (billboard) {
        // Keep sphere/halo facing the camera for readability.
        billboard.quaternion.copy(options.camera.quaternion)
      }

      const directionName = handle.userData?.directionGroupName as string | undefined
      const directionGroup = handle.getObjectByName(directionName ?? DIRECTION_GROUP_NAME)
      const dirRaw = handle.userData?.direction as THREE.Vector3 | null | undefined
      if (directionGroup && dirRaw && (dirRaw as any).isVector3) {
        tmpDir.copy(dirRaw)
        if (tmpDir.lengthSq() > 1e-10) {
          tmpDir.normalize()
          tmpQuat.setFromUnitVectors(DEFAULT_FORWARD, tmpDir)
          directionGroup.quaternion.copy(tmpQuat)
        }
      }
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
