import * as THREE from 'three'
import type {
  EndpointGizmoAxis,
  EndpointGizmoObject,
  EndpointGizmoPart,
  EndpointGizmoState,
} from './EndpointGizmo'

type HouseRigScaleGizmoOptions = {
  axis: EndpointGizmoAxis
  color: number
  renderOrder?: number
}

type StateMaterials = Record<EndpointGizmoState, THREE.MeshBasicMaterial>

const AXIS_PARTS: Record<EndpointGizmoAxis, EndpointGizmoPart> = {
  x: 'px',
  y: 'py',
  z: 'pz',
}

function createMaterialState(
  color: number,
  opacity: number,
  state: EndpointGizmoState,
): StateMaterials[EndpointGizmoState] {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: state === 'active' ? 1 : state === 'hover' ? Math.min(1, opacity + 0.12) : opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  return material
}

function createMaterials(color: number): StateMaterials {
  return {
    normal: createMaterialState(color, 0.88, 'normal'),
    hover: createMaterialState(color, 0.96, 'hover'),
    active: createMaterialState(color, 1, 'active'),
  }
}

export function createHouseRigScaleGizmoObject(
  options: HouseRigScaleGizmoOptions,
): EndpointGizmoObject {
  const renderOrder = options.renderOrder ?? 1002
  const part = AXIS_PARTS[options.axis]
  const root = new THREE.Group()
  root.name = `HouseRigScale_${part}`
  root.userData.endpointGizmoRoot = true
  root.userData.editorOnly = true
  root.userData.houseRigScaleGizmo = true

  const axisGroup = new THREE.Group()
  axisGroup.name = `HouseRigScale_Axis_${part}`
  if (options.axis === 'x') {
    axisGroup.rotation.z = -Math.PI / 2
  } else if (options.axis === 'z') {
    axisGroup.rotation.x = Math.PI / 2
  }
  root.add(axisGroup)

  const shaftGeometry = new THREE.CylinderGeometry(0.026, 0.038, 0.68, 12, 1)
  const collarGeometry = new THREE.CylinderGeometry(0.052, 0.052, 0.045, 12, 1)
  const coreGeometry = new THREE.BoxGeometry(0.17, 0.17, 0.17)
  const hitGeometry = new THREE.BoxGeometry(0.38, 0.38, 0.38)
  const outlineGeometry = new THREE.EdgesGeometry(coreGeometry, 20)

  const materials = createMaterials(options.color)
  const outlineMaterials: Record<EndpointGizmoState, THREE.LineBasicMaterial> = {
    normal: new THREE.LineBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    hover: new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    active: new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  }
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    colorWrite: false,
  })

  const markPart = (object: THREE.Object3D): void => {
    object.layers.enableAll()
    object.renderOrder = renderOrder
    object.userData.endpointGizmoPart = part
    object.userData.endpointGizmoAxisName = options.axis
    object.userData.endpointGizmoAxisSign = 1
    object.userData.endpointGizmoAxis = new THREE.Vector3(
      options.axis === 'x' ? 1 : 0,
      options.axis === 'y' ? 1 : 0,
      options.axis === 'z' ? 1 : 0,
    )
  }

  const shaft = new THREE.Mesh(shaftGeometry, materials.normal)
  shaft.name = `HouseRigScale_Shaft_${part}`
  shaft.position.y = 0.39
  markPart(shaft)
  axisGroup.add(shaft)

  const collars = [0.28, 0.53].map((height, index) => {
    const collar = new THREE.Mesh(collarGeometry, materials.normal)
    collar.name = `HouseRigScale_Collar_${index + 1}_${part}`
    collar.position.y = height
    markPart(collar)
    axisGroup.add(collar)
    return collar
  })

  const cube = new THREE.Mesh(coreGeometry, materials.normal)
  cube.name = `HouseRigScale_Cube_${part}`
  cube.position.y = 0.86
  markPart(cube)
  axisGroup.add(cube)

  const outline = new THREE.LineSegments(outlineGeometry, outlineMaterials.normal)
  outline.name = `HouseRigScale_Outline_${part}`
  outline.position.copy(cube.position)
  outline.scale.setScalar(1.12)
  markPart(outline)
  axisGroup.add(outline)

  const hit = new THREE.Mesh(hitGeometry, hitMaterial)
  hit.name = `HouseRigScale_Hit_${part}`
  hit.position.copy(cube.position)
  markPart(hit)
  axisGroup.add(hit)

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.userData.overrideMaterial = true
    }
  })

  let disposed = false
  const meshMaterials = new Map<THREE.Mesh, StateMaterials | null>([
    [shaft, materials],
    [cube, materials],
    ...collars.map((collar) => [collar, materials] as const),
  ])

  const setState = (_part: EndpointGizmoPart, state: EndpointGizmoState): void => {
    if (disposed || _part !== part) {
      return
    }
    meshMaterials.forEach((stateMaterials, mesh) => {
      if (stateMaterials) {
        mesh.material = stateMaterials[state]
      }
    })
    outline.material = outlineMaterials[state]
  }

  const clearStates = (): void => {
    if (disposed) {
      return
    }
    meshMaterials.forEach((stateMaterials, mesh) => {
      if (stateMaterials) {
        mesh.material = stateMaterials.normal
      }
    })
    outline.material = outlineMaterials.normal
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    shaftGeometry.dispose()
    collarGeometry.dispose()
    coreGeometry.dispose()
    hitGeometry.dispose()
    outlineGeometry.dispose()
    Object.values(materials).forEach((material) => material.dispose())
    Object.values(outlineMaterials).forEach((material) => material.dispose())
    hitMaterial.dispose()
    root.removeFromParent()
  }

  return {
    root,
    baseDiameter: 1.05,
    dispose,
    setState,
    clearStates,
  }
}
