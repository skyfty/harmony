import * as THREE from 'three'
import type { PhysicsBackendPreference, PhysicsBodyDesc, PhysicsSceneAsset, PhysicsShapeDesc, PhysicsStepFrame } from '@harmony/physics-core'

export type PhysicsCollisionDebugEngine = Extract<PhysicsBackendPreference, 'ammo' | 'cannon'>

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

type ShapeMap = Map<number, PhysicsShapeDesc>

type AmmoBodyEntry = {
  body: PhysicsBodyDesc
  group: THREE.Group
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function disposeObject3D(object: THREE.Object3D, disposeMaterials: boolean): void {
  object.traverse((node) => {
    const maybeMesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
    if (maybeMesh.geometry) {
      maybeMesh.geometry.dispose()
    }
    if (!disposeMaterials) {
      return
    }
    const material = maybeMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material?.dispose?.()
    }
  })
}

function createLineGeometryFromPoints(points: Array<[number, number, number]>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const flattened = new Float32Array(points.length * 3)
  points.forEach((point, index) => {
    const base = index * 3
    flattened[base] = point[0]
    flattened[base + 1] = point[1]
    flattened[base + 2] = point[2]
  })
  geometry.setAttribute('position', new THREE.BufferAttribute(flattened, 3))
  return geometry
}

function createWireframeFromGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const wireframe = new THREE.WireframeGeometry(source)
  source.dispose()
  return wireframe
}

function createBoxWireframe(halfExtents: [number, number, number]): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(
    Math.max(1e-3, halfExtents[0] * 2),
    Math.max(1e-3, halfExtents[1] * 2),
    Math.max(1e-3, halfExtents[2] * 2),
  )
  return createWireframeFromGeometry(geometry)
}

function createSphereWireframe(radius: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(Math.max(1e-3, radius), 10, 8)
  return createWireframeFromGeometry(geometry)
}

function createCylinderWireframe(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments?: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    Math.max(1e-3, radiusTop),
    Math.max(1e-3, radiusBottom),
    Math.max(1e-3, height),
    Math.max(3, Math.trunc(segments ?? 12)),
    1,
    false,
  )
  return createWireframeFromGeometry(geometry)
}

function createConvexWireframe(shape: Extract<PhysicsShapeDesc, { kind: 'convex-hull' }>): THREE.BufferGeometry | null {
  if (shape.vertices.length < 9) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(shape.vertices.slice(), 3))
  if (Array.isArray(shape.faces) && shape.faces.length) {
    const indices: number[] = []
    shape.faces.forEach((face) => {
      if (!Array.isArray(face) || face.length < 3) {
        return
      }
      const first = Math.trunc(face[0] ?? 0)
      for (let index = 1; index < face.length - 1; index += 1) {
        indices.push(first, Math.trunc(face[index] ?? 0), Math.trunc(face[index + 1] ?? 0))
      }
    })
    if (indices.length) {
      geometry.setIndex(indices)
      return createWireframeFromGeometry(geometry)
    }
  }
  const points: THREE.Vector3[] = []
  for (let index = 0; index < shape.vertices.length; index += 3) {
    points.push(new THREE.Vector3(shape.vertices[index] ?? 0, shape.vertices[index + 1] ?? 0, shape.vertices[index + 2] ?? 0))
  }
  if (!points.length) {
    geometry.dispose()
    return null
  }
  const bounds = new THREE.Box3().setFromPoints(points)
  geometry.dispose()
  if (!bounds.isEmpty()) {
    return createBoxWireframe([
      Math.max(1e-3, (bounds.max.x - bounds.min.x) * 0.5),
      Math.max(1e-3, (bounds.max.y - bounds.min.y) * 0.5),
      Math.max(1e-3, (bounds.max.z - bounds.min.z) * 0.5),
    ])
  }
  return null
}

function createStaticMeshWireframe(shape: Extract<PhysicsShapeDesc, { kind: 'static-mesh' }>): THREE.BufferGeometry | null {
  if (shape.vertices.length < 9) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(shape.vertices.slice(), 3))
  if (shape.indices.length) {
    geometry.setIndex(Array.from(shape.indices))
  }
  return createWireframeFromGeometry(geometry)
}

function createHeightfieldWireframe(shape: Extract<PhysicsShapeDesc, { kind: 'heightfield' }>): THREE.BufferGeometry | null {
  const rows = Math.max(0, Math.trunc(shape.rows))
  const columns = Math.max(0, Math.trunc(shape.columns))
  if (rows < 2 || columns < 2 || shape.heights.length < rows * columns) {
    return null
  }
  const elementSize = Math.max(1e-3, shape.elementSize)
  const offset = shape.localOffset ?? [0, 0, 0]
  const points: Array<[number, number, number]> = []
  const getHeight = (column: number, row: number): number => {
    const index = (column * rows) + row
    return shape.heights[index] ?? 0
  }
  const pushPoint = (column: number, row: number): [number, number, number] => {
    return [
      (offset[0] ?? 0) + (column * elementSize),
      (offset[1] ?? 0) + getHeight(column, row),
      (offset[2] ?? 0) + (row * elementSize),
    ]
  }

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      points.push(pushPoint(column, row), pushPoint(column, row + 1))
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      points.push(pushPoint(column, row), pushPoint(column + 1, row))
    }
  }

  return createLineGeometryFromPoints(points)
}

function createShapeWireframeGeometry(shape: PhysicsShapeDesc): THREE.BufferGeometry | null {
  switch (shape.kind) {
    case 'box':
      return createBoxWireframe(shape.halfExtents)
    case 'sphere':
      return createSphereWireframe(shape.radius)
    case 'cylinder':
      return createCylinderWireframe(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments)
    case 'convex-hull':
      return createConvexWireframe(shape)
    case 'static-mesh':
      return createStaticMeshWireframe(shape)
    case 'heightfield':
      return createHeightfieldWireframe(shape)
    case 'compound':
      return null
    default:
      return null
  }
}

function createShapeGroup(
  shapeId: number,
  shapeMap: ShapeMap,
  material: THREE.LineBasicMaterial,
): THREE.Object3D | null {
  const shape = shapeMap.get(shapeId)
  if (!shape) {
    return null
  }

  if (shape.kind === 'compound') {
    const group = new THREE.Group()
    group.name = `PhysicsDebugCompound_${shapeId}`
    shape.children.forEach((child) => {
      const childShape = createShapeGroup(child.shapeId, shapeMap, material)
      if (!childShape) {
        return
      }
      if (child.transform) {
        const [px, py, pz] = child.transform.position
        const [qx, qy, qz, qw] = child.transform.rotation
        childShape.position.set(px ?? 0, py ?? 0, pz ?? 0)
        childShape.quaternion.set(qx ?? 0, qy ?? 0, qz ?? 0, qw ?? 1)
      }
      group.add(childShape)
    })
    return group
  }

  const geometry = createShapeWireframeGeometry(shape)
  if (!geometry) {
    return null
  }
  const line = new THREE.LineSegments(geometry, material)
  line.frustumCulled = false
  line.name = `PhysicsDebugShape_${shapeId}`
  return line
}

export class ScenePreviewPhysicsCollisionDebugRuntime {
  readonly root = new THREE.Group()

  private ammoLineMaterial: THREE.LineBasicMaterial | null = null

  private scene: THREE.Scene | null = null
  private currentEngine: PhysicsCollisionDebugEngine | null = null
  private currentAsset: PhysicsSceneAsset | null = null
  private ammoBodies = new Map<number, AmmoBodyEntry>()
  private cannonWorld: unknown | null = null
  private cannonDebugger: CannonDebuggerLike | null = null
  private visible = true

  constructor() {
    this.root.name = 'PhysicsCollisionDebugRoot'
    this.root.visible = true
  }

  attachScene(scene: THREE.Scene | null): void {
    if (this.scene === scene) {
      return
    }
    if (this.scene) {
      this.scene.remove(this.root)
    }
    this.scene = scene
    if (this.scene) {
      this.scene.add(this.root)
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.root.visible = visible
    this.cannonDebugger?.setVisible?.(visible)
  }

  setEngine(engine: PhysicsCollisionDebugEngine | null): void {
    if (this.currentEngine === engine) {
      return
    }
    this.destroyCannonDebugger()
    this.clearAmmoBodies()
    this.currentEngine = engine
    if (engine === 'ammo') {
      this.rebuildAmmoScene()
      return
    }
    if (engine === 'cannon') {
      void this.ensureCannonDebugger()
    }
  }

  setSceneAsset(asset: PhysicsSceneAsset | null): void {
    this.currentAsset = asset
    if (this.currentEngine === 'ammo') {
      this.rebuildAmmoScene()
    }
  }

  applyStepFrame(frame: PhysicsStepFrame): void {
    if (this.currentEngine !== 'ammo' || !this.currentAsset || frame.bodyCount <= 0) {
      return
    }
    const bodyMeta = frame.bodyMeta ?? null
    for (let index = 0; index < frame.bodyCount; index += 1) {
      const bodyId = bodyMeta?.[index]
      if (!isFiniteNumber(bodyId)) {
        continue
      }
      const entry = this.ammoBodies.get(bodyId)
      if (!entry) {
        continue
      }
      const base = index * 8
      entry.group.position.set(
        frame.bodyTransforms[base] ?? 0,
        frame.bodyTransforms[base + 1] ?? 0,
        frame.bodyTransforms[base + 2] ?? 0,
      )
      entry.group.quaternion.set(
        frame.bodyTransforms[base + 3] ?? 0,
        frame.bodyTransforms[base + 4] ?? 0,
        frame.bodyTransforms[base + 5] ?? 0,
        frame.bodyTransforms[base + 6] ?? 1,
      ).normalize()
    }
  }

  setCannonWorld(world: unknown | null): void {
    if (this.cannonWorld === world) {
      return
    }
    this.cannonWorld = world
    if (this.currentEngine === 'cannon') {
      this.destroyCannonDebugger()
      void this.ensureCannonDebugger()
    }
  }

  update(): void {
    if (this.currentEngine === 'cannon' && this.visible) {
      this.cannonDebugger?.update?.()
    }
  }

  resetBackend(): void {
    this.destroyCannonDebugger()
    this.clearAmmoBodies()
    this.currentAsset = null
    this.cannonWorld = null
    this.currentEngine = null
  }

  destroy(): void {
    this.resetBackend()
    this.attachScene(null)
    this.disposeAmmoLineMaterial()
    this.root.clear()
  }

  private rebuildAmmoScene(): void {
    this.clearAmmoBodies()
    const asset = this.currentAsset
    if (!asset) {
      return
    }
    const material = this.ensureAmmoLineMaterial()
    const shapeMap: ShapeMap = new Map(asset.shapes.map((shape) => [shape.id, shape]))
    asset.bodies.forEach((body) => {
      const group = new THREE.Group()
      group.name = `PhysicsDebugBody_${body.id}`
      group.position.set(body.transform.position[0] ?? 0, body.transform.position[1] ?? 0, body.transform.position[2] ?? 0)
      group.quaternion.set(
        body.transform.rotation[0] ?? 0,
        body.transform.rotation[1] ?? 0,
        body.transform.rotation[2] ?? 0,
        body.transform.rotation[3] ?? 1,
      ).normalize()

      const shapeNode = createShapeGroup(body.shapeId, shapeMap, material)
      if (shapeNode) {
        group.add(shapeNode)
      }

      this.root.add(group)
      this.ammoBodies.set(body.id, { body, group })
    })
    this.root.visible = this.visible
  }

  private clearAmmoBodies(): void {
    this.ammoBodies.forEach(({ group }) => {
      this.root.remove(group)
      disposeObject3D(group, false)
    })
    this.ammoBodies.clear()
  }

  private ensureAmmoLineMaterial(): THREE.LineBasicMaterial {
    if (!this.ammoLineMaterial) {
      this.ammoLineMaterial = new THREE.LineBasicMaterial({
        color: 0x66d9ff,
        transparent: true,
        opacity: 0.84,
        depthTest: false,
        depthWrite: false,
      })
    }
    return this.ammoLineMaterial
  }

  private disposeAmmoLineMaterial(): void {
    this.ammoLineMaterial?.dispose()
    this.ammoLineMaterial = null
  }

  private destroyCannonDebugger(): void {
    if (!this.cannonDebugger) {
      return
    }
    try {
      this.cannonDebugger.clear?.()
      this.cannonDebugger.destroy?.()
    } catch (error) {
      console.warn('[ScenePreviewPhysicsCollisionDebugRuntime] Failed to destroy cannon debugger', error)
    } finally {
      this.cannonDebugger = null
    }
  }

  private async ensureCannonDebugger(): Promise<void> {
    if (this.currentEngine !== 'cannon' || !this.cannonWorld) {
      this.destroyCannonDebugger()
      return
    }
    if (this.cannonDebugger) {
      this.cannonDebugger.setVisible?.(this.visible)
      return
    }
    try {
      const module = await import('@vladkrutenyuk/cannon-es-debugger-pro')
      const CannonEsDebuggerPro = (module as unknown as { CannonEsDebuggerPro?: new (
        root: THREE.Object3D,
        world: unknown,
        color?: THREE.ColorRepresentation,
        offset?: number,
      ) => CannonDebuggerLike }).CannonEsDebuggerPro
        ?? (module as unknown as { default?: new (
          root: THREE.Object3D,
          world: unknown,
          color?: THREE.ColorRepresentation,
          offset?: number,
        ) => CannonDebuggerLike }).default

      if (!CannonEsDebuggerPro) {
        throw new Error('Cannon debugger module did not expose CannonEsDebuggerPro')
      }

      this.destroyCannonDebugger()
      this.cannonDebugger = new CannonEsDebuggerPro(this.root, this.cannonWorld, 0x66d9ff, 0.005)
      this.cannonDebugger.setVisible?.(this.visible)
    } catch (error) {
      console.warn('[ScenePreviewPhysicsCollisionDebugRuntime] Failed to create cannon debugger', error)
      this.destroyCannonDebugger()
    }
  }
}
