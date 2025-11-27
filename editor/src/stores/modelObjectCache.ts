import {
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  type Material,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type MergeFn =
  | ((geometries: BufferGeometry[], useGroups?: boolean) => BufferGeometry | null)
  | undefined

const mergeBufferGeometries: MergeFn =
  (BufferGeometryUtils as unknown as { mergeBufferGeometries?: MergeFn }).mergeBufferGeometries ??
  (BufferGeometryUtils as unknown as { mergeGeometries?: MergeFn }).mergeGeometries

interface TemplateMetadata {
  name: string
  castShadow: boolean
  receiveShadow: boolean
  frustumCulled: boolean
  visible: boolean
  matrixAutoUpdate: boolean
  userData: Record<string, unknown>
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

const IDENTITY_MATRIX = new Matrix4()

class ModelTemplate extends Object3D {
  readonly assetId: string
  readonly geometry: BufferGeometry
  readonly material: Material | Material[]
  private readonly metadata: TemplateMetadata

  constructor(assetId: string, geometry: BufferGeometry, material: Material | Material[], metadata: TemplateMetadata) {
    super()
    this.assetId = assetId
    this.geometry = geometry
    this.material = material
    this.metadata = metadata
    this.name = metadata.name
    this.castShadow = metadata.castShadow
    this.receiveShadow = metadata.receiveShadow
    this.frustumCulled = metadata.frustumCulled
    this.visible = metadata.visible
    this.matrixAutoUpdate = metadata.matrixAutoUpdate
    this.userData = { ...metadata.userData }
  }

  createInstance(): InstancedMesh {
    const material = Array.isArray(this.material)
      ? this.material.map((entry) => entry.clone())
      : this.material.clone()
    if (!mergeBufferGeometries) {
      console.warn('BufferGeometryUtils.mergeBufferGeometries not available; instancing may degrade performance')
    }
    const mesh = new InstancedMesh(this.geometry, material, 1)
    mesh.name = this.metadata.name
    mesh.castShadow = this.metadata.castShadow
    mesh.receiveShadow = this.metadata.receiveShadow
    mesh.frustumCulled = this.metadata.frustumCulled
    mesh.visible = this.metadata.visible
    mesh.matrixAutoUpdate = this.metadata.matrixAutoUpdate
    mesh.userData = { ...this.metadata.userData }
    mesh.position.copy(this.metadata.position)
    mesh.quaternion.copy(this.metadata.quaternion)
    mesh.scale.copy(this.metadata.scale)
    mesh.updateMatrix()
    mesh.setMatrixAt(0, IDENTITY_MATRIX)
    mesh.instanceMatrix.needsUpdate = true
    mesh.userData.__instancedAssetId = this.assetId
    return mesh
  }

  override clone(_recursive?: boolean): this {
    return this.createInstance() as unknown as this
  }
}

const modelObjectCache = new Map<string, ModelTemplate>()
const pendingLoads = new Map<string, Promise<ModelTemplate>>()

export function getCachedModelObject(assetId: string): Object3D | null {
  return modelObjectCache.get(assetId) ?? null
}

export function getOrLoadModelObject(assetId: string, loader: () => Promise<Object3D>): Promise<Object3D> {
  const cached = modelObjectCache.get(assetId)
  if (cached) {
    return Promise.resolve(cached)
  }

  const pending = pendingLoads.get(assetId)
  if (pending) {
    return pending
  }

  const promise = loader()
    .then((object) => {
      const template = createModelTemplate(assetId, object)
      modelObjectCache.set(assetId, template)
      pendingLoads.delete(assetId)
      return template
    })
    .catch((error) => {
      pendingLoads.delete(assetId)
      throw error
    })

  pendingLoads.set(assetId, promise)
  return promise
}

export function invalidateModelObject(assetId: string): void {
  const existing = modelObjectCache.get(assetId)
  if (existing) {
    disposeTemplate(existing)
    modelObjectCache.delete(assetId)
  }
  pendingLoads.delete(assetId)
}

export function clearModelObjectCache(): void {
  modelObjectCache.forEach((template) => {
    disposeTemplate(template)
  })
  modelObjectCache.clear()
  pendingLoads.clear()
}

function disposeTemplate(template: ModelTemplate) {
  template.geometry.dispose()
  if (Array.isArray(template.material)) {
    template.material.forEach((material) => {
      material.dispose?.()
    })
  } else {
    template.material.dispose?.()
  }
}

function createModelTemplate(assetId: string, source: Object3D): ModelTemplate {
  const meshes: Mesh[] = []
  source.updateMatrixWorld(true)
  source.traverse((child) => {
    if ((child as Mesh).isMesh) {
      meshes.push(child as Mesh)
    }
  })

  if (!meshes.length) {
    throw new Error('模型中未找到可渲染的网格数据')
  }

  const merged = mergeMeshes(source, meshes)
  const metadata: TemplateMetadata = {
    name: source.name || `model::${assetId}`,
    castShadow: meshes.some((mesh) => mesh.castShadow),
    receiveShadow: meshes.some((mesh) => mesh.receiveShadow),
    frustumCulled: meshes.some((mesh) => mesh.frustumCulled),
    visible: source.visible,
    matrixAutoUpdate: source.matrixAutoUpdate,
    userData: { ...source.userData },
    position: source.position.clone(),
    quaternion: source.quaternion.clone(),
    scale: source.scale.clone(),
  }

  return new ModelTemplate(assetId, merged.geometry, merged.material, metadata)
}

function mergeMeshes(root: Object3D, meshes: Mesh[]): { geometry: BufferGeometry; material: Material | Material[] } {
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  let materialOffset = 0
  const rootMatrixWorldInverse = root.matrixWorld.clone().invert()

  meshes.forEach((mesh) => {
    const geometry = mesh.geometry.clone()
    const relativeMatrix = new Matrix4().multiplyMatrices(rootMatrixWorldInverse, mesh.matrixWorld)
    geometry.applyMatrix4(relativeMatrix)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const baseIndex = materialOffset
    materialList.forEach((material) => {
      materials.push(material.clone())
    })
    materialOffset = materials.length

    if (!geometry.groups.length) {
      const positionAttribute = geometry.attributes.position
      const count = geometry.index ? geometry.index.count : positionAttribute?.count ?? 0
      geometry.addGroup(0, count, baseIndex)
    } else {
      geometry.groups.forEach((group) => {
        group.materialIndex = (group.materialIndex ?? 0) + baseIndex
      })
    }

    geometries.push(geometry)
  })

  if (!materials.length) {
    materials.push(new MeshStandardMaterial({ color: 0xffffff }))
  }

  let mergedGeometry: BufferGeometry | null = null

  if (!mergeBufferGeometries) {
    console.warn('BufferGeometryUtils.mergeBufferGeometries 不可用，使用第一个网格作为后备方案')
  } else if (geometries.length > 1) {
    mergedGeometry = mergeBufferGeometries(geometries, true)
  }

  if (!mergedGeometry) {
    mergedGeometry = geometries[0] ?? null
  }

  if (!mergedGeometry) {
    throw new Error('模型网格合并失败：缺少有效几何数据')
  }

  geometries.forEach((geometry) => {
    if (geometry !== mergedGeometry) {
      geometry.dispose()
    }
  })

  mergedGeometry.computeBoundingBox()
  mergedGeometry.computeBoundingSphere()

  const materialReference: Material | Material[] = materials.length === 1 ? materials[0]! : materials

  return {
    geometry: mergedGeometry,
    material: materialReference,
  }
}
