import * as THREE from 'three'

export type EndpointGizmoPart =
  | 'center'
  | 'px'
  | 'nx'
  | 'py'
  | 'ny'
  | 'pz'
  | 'nz'

export type EndpointGizmoAxis = 'x' | 'y' | 'z'

export type EndpointGizmoPartInfo =
  | { kind: 'center' }
  | { kind: 'axis'; axis: THREE.Vector3; axisName: EndpointGizmoAxis; sign: 1 | -1 }

export type EndpointGizmoState = 'normal' | 'hover' | 'active'

export type EndpointGizmoBuildOptions = {
  axes?: Partial<Record<EndpointGizmoAxis, boolean>>
  showNegativeAxes?: boolean
  renderOrder?: number
  depthTest?: boolean
  depthWrite?: boolean
  opacity?: number
  centerColor?: number

  /**
   * When true, the gizmo's normal state is fully invisible (but still raycastable).
   * Hover/active states remain visible.
   */
  hideNormalState?: boolean
}

const DEFAULT_AXIS_ENABLED: Record<EndpointGizmoAxis, boolean> = { x: true, y: true, z: true }

function colorForAxis(axis: EndpointGizmoAxis): number {
  switch (axis) {
    case 'x':
      return 0xff5252
    case 'y':
      return 0x4caf50
    case 'z':
      return 0x448aff
  }
}

function darken(color: number, factor: number): number {
  const f = THREE.MathUtils.clamp(factor, 0, 1)
  const r = ((color >> 16) & 0xff) / 255
  const g = ((color >> 8) & 0xff) / 255
  const b = (color & 0xff) / 255
  const rr = Math.round(255 * r * f)
  const gg = Math.round(255 * g * f)
  const bb = Math.round(255 * b * f)
  return (rr << 16) | (gg << 8) | bb
}

function createEmissiveMaterial(options: {
  color: number
  emissiveIntensity: number
  opacity: number
  depthTest: boolean
  depthWrite: boolean
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    emissive: options.color,
    emissiveIntensity: options.emissiveIntensity,
    metalness: 0,
    roughness: 0.4,
    transparent: options.opacity < 1,
    opacity: options.opacity,
    depthTest: options.depthTest,
    depthWrite: options.depthWrite,
  })
  material.toneMapped = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  return material
}

export type EndpointGizmoMaterials = {
  center: Record<EndpointGizmoState, THREE.MeshStandardMaterial>
  axis: Record<EndpointGizmoAxis, {
    positive: Record<EndpointGizmoState, THREE.MeshStandardMaterial>
    negative: Record<EndpointGizmoState, THREE.MeshStandardMaterial>
  }>
}

export function createEndpointGizmoMaterials(options?: {
  opacity?: number
  depthTest?: boolean
  depthWrite?: boolean
  centerColor?: number
  hideNormalState?: boolean
}): EndpointGizmoMaterials {
  const baseOpacity = typeof options?.opacity === 'number' ? THREE.MathUtils.clamp(options.opacity, 0.1, 1) : 0.9
  const hideNormalState = options?.hideNormalState ?? false
  const depthTest = options?.depthTest ?? false
  const depthWrite = options?.depthWrite ?? false
  const centerColor = typeof options?.centerColor === 'number' ? options.centerColor : 0xffc107

  const makeStates = (color: number) => {
    const normalOpacity = hideNormalState ? 0 : baseOpacity
    const normal = createEmissiveMaterial({ color, emissiveIntensity: 0.15, opacity: normalOpacity, depthTest, depthWrite })
    if (hideNormalState) {
      // Keep raycastable while fully invisible.
      normal.transparent = true
      normal.opacity = 0
      normal.depthWrite = false
      normal.colorWrite = false
    }

    return {
      normal,
      hover: createEmissiveMaterial({ color, emissiveIntensity: 0.9, opacity: Math.min(1, baseOpacity + 0.05), depthTest, depthWrite }),
      active: createEmissiveMaterial({ color, emissiveIntensity: 1.5, opacity: 1, depthTest, depthWrite }),
    }
  }

  return {
    center: makeStates(centerColor),
    axis: {
      x: { positive: makeStates(colorForAxis('x')), negative: makeStates(darken(colorForAxis('x'), 0.6)) },
      y: { positive: makeStates(colorForAxis('y')), negative: makeStates(darken(colorForAxis('y'), 0.6)) },
      z: { positive: makeStates(colorForAxis('z')), negative: makeStates(darken(colorForAxis('z'), 0.6)) },
    },
  }
}

export type EndpointGizmoObject = {
  root: THREE.Group
  baseDiameter: number
  dispose(): void
  setState(part: EndpointGizmoPart, state: EndpointGizmoState): void
  clearStates(): void
}

export function createEndpointGizmoObject(options?: EndpointGizmoBuildOptions): EndpointGizmoObject {
  const axes = { ...DEFAULT_AXIS_ENABLED, ...(options?.axes ?? {}) }
  const showNegativeAxes = options?.showNegativeAxes ?? true
  const renderOrder = typeof options?.renderOrder === 'number' ? options.renderOrder : 1001
  const depthTest = options?.depthTest ?? false
  const depthWrite = options?.depthWrite ?? false
  const opacity = typeof options?.opacity === 'number' ? THREE.MathUtils.clamp(options.opacity, 0.1, 1) : 0.9
  const hideNormalState = options?.hideNormalState ?? false

  const materials = createEndpointGizmoMaterials({
    opacity,
    depthTest,
    depthWrite,
    centerColor: typeof options?.centerColor === 'number' ? options.centerColor : undefined,
    hideNormalState,
  })

  const root = new THREE.Group()
  root.userData.endpointGizmoRoot = true
  root.userData.editorOnly = true

  // Base diameter used for screen-space scaling in renderers.
  // Shrink center sphere so arrows remain the primary, easier-to-click targets.
  const baseSphereRadius = 0.35
  const baseDiameter = baseSphereRadius * 2

  const sphereGeo = new THREE.SphereGeometry(baseSphereRadius, 18, 14)
  const center = new THREE.Mesh(sphereGeo, materials.center.normal)
  center.name = 'EndpointGizmo_Center'
  center.renderOrder = renderOrder
  center.layers.enableAll()
  center.userData.endpointGizmoPart = 'center'
  root.add(center)

  const shaftRadius = 0.06
  const shaftLength = 0.75
  const coneRadius = 0.14
  const coneLength = 0.35
  const arrowOffsetFromCenter = baseSphereRadius + 0.08

  const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12, 1)
  const coneGeo = new THREE.ConeGeometry(coneRadius, coneLength, 14, 1)

  const makeArrow = (axisName: EndpointGizmoAxis, sign: 1 | -1) => {
    const part: EndpointGizmoPart =
      axisName === 'x'
        ? (sign === 1 ? 'px' : 'nx')
        : axisName === 'y'
          ? (sign === 1 ? 'py' : 'ny')
          : (sign === 1 ? 'pz' : 'nz')

    const axis = new THREE.Vector3(
      axisName === 'x' ? sign : 0,
      axisName === 'y' ? sign : 0,
      axisName === 'z' ? sign : 0,
    )

    const group = new THREE.Group()
    group.name = `EndpointGizmo_Arrow_${part}`
    group.renderOrder = renderOrder
    group.layers.enableAll()

    const matSet = sign === 1 ? materials.axis[axisName].positive : materials.axis[axisName].negative

    const shaft = new THREE.Mesh(shaftGeo, matSet.normal)
    shaft.name = `EndpointGizmo_Shaft_${part}`
    shaft.renderOrder = renderOrder
    shaft.layers.enableAll()

    const cone = new THREE.Mesh(coneGeo, matSet.normal)
    cone.name = `EndpointGizmo_Cone_${part}`
    cone.renderOrder = renderOrder
    cone.layers.enableAll()

    // CylinderGeometry and ConeGeometry are aligned on Y axis by default.
    // We'll rotate the whole arrow group to match target axis.
    shaft.position.y = arrowOffsetFromCenter + shaftLength / 2
    cone.position.y = arrowOffsetFromCenter + shaftLength + coneLength / 2

    group.add(shaft)
    group.add(cone)

    if (axisName === 'x') {
      group.rotation.z = -Math.PI / 2
    } else if (axisName === 'z') {
      group.rotation.x = Math.PI / 2
    }

    if (sign === -1) {
      group.rotateZ(Math.PI)
    }

    for (const m of [shaft, cone]) {
      m.userData.endpointGizmoPart = part
      m.userData.endpointGizmoAxisName = axisName
      m.userData.endpointGizmoAxisSign = sign
      m.userData.endpointGizmoAxis = axis.clone()
    }

    root.add(group)
  }

  if (axes.x) {
    makeArrow('x', 1)
    if (showNegativeAxes) makeArrow('x', -1)
  }
  if (axes.y) {
    makeArrow('y', 1)
    if (showNegativeAxes) makeArrow('y', -1)
  }
  if (axes.z) {
    makeArrow('z', 1)
    if (showNegativeAxes) makeArrow('z', -1)
  }

  // Endpoint gizmos are editor-only interaction handles.
  // They should not inherit node material overrides (tinting, textures, etc),
  // otherwise they can become the same color as the edited node and lose visibility.
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) return
    mesh.userData.overrideMaterial = true
  })

  const disposed = { value: false }
  const stateMap = new Map<EndpointGizmoPart, EndpointGizmoState>()

  const setState = (part: EndpointGizmoPart, state: EndpointGizmoState) => {
    if (disposed.value) return
    stateMap.set(part, state)

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh?.isMesh) return
      const p = mesh.userData?.endpointGizmoPart as EndpointGizmoPart | undefined
      if (p !== part) return

      if (p === 'center') {
        mesh.material = materials.center[state]
        return
      }

      const axisName = mesh.userData?.endpointGizmoAxisName as EndpointGizmoAxis | undefined
      const sign = mesh.userData?.endpointGizmoAxisSign as 1 | -1 | undefined
      if (!axisName || (sign !== 1 && sign !== -1)) {
        return
      }
      const matSet = sign === 1 ? materials.axis[axisName].positive : materials.axis[axisName].negative
      mesh.material = matSet[state]
    })
  }

  const clearStates = () => {
    if (disposed.value) return
    for (const [part] of stateMap) {
      setState(part, 'normal')
    }
    stateMap.clear()
  }

  const dispose = () => {
    if (disposed.value) return
    disposed.value = true

    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh?.isMesh) {
        mesh.geometry?.dispose?.()
      }
    })

    const disposeMaterialStates = (matStates: Record<EndpointGizmoState, THREE.Material>) => {
      Object.values(matStates).forEach((m) => m?.dispose?.())
    }

    disposeMaterialStates(materials.center)
    ;(['x', 'y', 'z'] as EndpointGizmoAxis[]).forEach((axisName) => {
      disposeMaterialStates(materials.axis[axisName].positive)
      disposeMaterialStates(materials.axis[axisName].negative)
    })
  }

  return { root, baseDiameter, dispose, setState, clearStates }
}

export function getEndpointGizmoPartInfoFromObject(obj: THREE.Object3D | null | undefined): EndpointGizmoPartInfo | null {
  const part = obj?.userData?.endpointGizmoPart as EndpointGizmoPart | undefined
  if (!part) return null

  if (part === 'center') {
    return { kind: 'center' }
  }

  const axis = obj?.userData?.endpointGizmoAxis as THREE.Vector3 | undefined
  const axisName = obj?.userData?.endpointGizmoAxisName as EndpointGizmoAxis | undefined
  const sign = obj?.userData?.endpointGizmoAxisSign as 1 | -1 | undefined

  if (!axis || !(axis as any).isVector3 || !axisName || (sign !== 1 && sign !== -1)) {
    return null
  }

  return { kind: 'axis', axis: axis.clone().normalize(), axisName, sign }
}
