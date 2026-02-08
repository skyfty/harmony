import * as THREE from 'three'

export type DirectionalLightTargetHandleManager = {
  ensure(target: THREE.Object3D, options: { color: THREE.ColorRepresentation; helperSize: number }): void
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
}): THREE.Object3D {
  // Build a recognizable "sun" (sphere + halo ring) and keep it readable at large scales.
  // Reduce the minimum radius and scale factor so the on-screen handle appears smaller.
  const radius = Math.max(0.12, options.helperSize * 0.08)

  const group = new THREE.Group()
  group.name = TARGET_HANDLE_NAME
  group.renderOrder = 1000
  group.layers.enableAll()

  const billboardGroup = new THREE.Group()
  billboardGroup.name = BILLBOARD_GROUP_NAME
  billboardGroup.renderOrder = 1000
  billboardGroup.layers.enableAll()

  // Base diameter used for screen-space scaling.
  const haloOuter = radius * 2.2
  const directionLineLength = radius * 2.0
  const directionLineStart = haloOuter * 0.55
  const baseDiameter = (haloOuter + directionLineStart + directionLineLength) * 2
  group.userData = {
    ...(group.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
    baseDiameter,
  }

  // Slight lift to avoid z-fighting with ground/meshes at the target point.
  group.position.set(0, radius * 1.2, 0)

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
  }

  // Unity-like directional light hint: a few parallel lines indicating the light direction.
  // The group is oriented each frame based on the DirectionalLight -> target vector.
  const lineMat = new THREE.LineBasicMaterial({
    color: options.color,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    depthWrite: false,
  })
  lineMat.toneMapped = false

  const xOffsets = [-radius * 0.7, 0, radius * 0.7]
  const positions: number[] = []
  for (const x of xOffsets) {
    // Lines extend along +Z in local space.
    positions.push(x, 0, directionLineStart)
    positions.push(x, 0, directionLineStart + directionLineLength)
  }

  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const lines = new THREE.LineSegments(lineGeo, lineMat)
  lines.name = 'DirectionalLightTargetHandle_DirectionLines'
  lines.renderOrder = 998
  lines.layers.enableAll()
  lines.userData = {
    ...(lines.userData ?? {}),
    editorOnly: true,
    pickableEditorOnly: true,
    excludeFromOutline: true,
    isDirectionalLightTargetHandle: true,
  }
  directionGroup.add(lines)

  group.add(directionGroup)
  group.add(billboardGroup)

  return group
}

function refreshHandleColor(handle: THREE.Object3D, color: THREE.ColorRepresentation): void {
  handle.traverse((child) => {
    const anyChild = child as any
    const anyMaterial = anyChild?.material as THREE.Material | THREE.Material[] | null | undefined
    if (!anyMaterial) {
      return
    }
    const materials = Array.isArray(anyMaterial) ? anyMaterial : [anyMaterial]
    for (const material of materials) {
      const anyMat = material as any
      if (anyMat?.color?.set) {
        anyMat.color.set(color as any)
      }
    }
  })
}

export function createDirectionalLightTargetHandleManager(): DirectionalLightTargetHandleManager {
  const handles = new Set<THREE.Object3D>()

  const tmpWorld = new THREE.Vector3()
  const tmpCameraWorld = new THREE.Vector3()
  const tmpParentScale = new THREE.Vector3(1, 1, 1)
  const tmpTargetWorld = new THREE.Vector3()
  const tmpLightWorld = new THREE.Vector3()
  const tmpDirWorld = new THREE.Vector3()
  const tmpParentWorldQuat = new THREE.Quaternion()
  const tmpWorldQuat = new THREE.Quaternion()
  const FORWARD = new THREE.Vector3(0, 0, 1)

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

      // Billboard only the “sun” icon for readability; keep direction lines in world orientation.
      const billboard = handle.getObjectByName(BILLBOARD_GROUP_NAME)
      if (billboard) {
        billboard.quaternion.copy(options.camera.quaternion)
      }

      const directionGroup = handle.getObjectByName(DIRECTION_GROUP_NAME)
      const targetObject = handle.parent as THREE.Object3D | null
      const container = targetObject?.parent as THREE.Object3D | null
      const directionalLight = (container?.children ?? []).find((child) => (child as any)?.isDirectionalLight) as
        | THREE.DirectionalLight
        | undefined

      if (directionGroup && targetObject && directionalLight) {
        targetObject.getWorldPosition(tmpTargetWorld)
        directionalLight.getWorldPosition(tmpLightWorld)
        tmpDirWorld.subVectors(tmpTargetWorld, tmpLightWorld)

        if (tmpDirWorld.lengthSq() < 1e-10) {
          tmpDirWorld.copy(FORWARD)
        } else {
          tmpDirWorld.normalize()
        }

        // Compute local rotation so that +Z aligns with the world direction.
        tmpWorldQuat.setFromUnitVectors(FORWARD, tmpDirWorld)
        directionGroup.parent?.getWorldQuaternion(tmpParentWorldQuat)
        tmpParentWorldQuat.invert()
        directionGroup.quaternion.copy(tmpParentWorldQuat).multiply(tmpWorldQuat)
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
