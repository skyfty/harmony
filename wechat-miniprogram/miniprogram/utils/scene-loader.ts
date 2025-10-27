import type * as THREE_NS from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader'
import {
  type StoredSceneDocument,
  type SceneNode,
  type SceneNodeMaterial,
  type SceneMaterial,
  type SceneMaterialProps,
  type SceneDynamicMesh,
  type GroundDynamicMesh,
  type WallDynamicMesh,
  type SceneCameraState,
  type Vector3Like,
  type ProjectAsset,
} from './scene-types'

const LOCAL_ASSET_PREFIX = 'local::'
const DEFAULT_SCENE_BACKGROUND = '#101720'
const DEFAULT_SCENE_FOG_COLOR = '#0d1520'

const WX: any =
  typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).wx
    ? (globalThis as Record<string, unknown>).wx
    : undefined

export interface SceneBuildOptions {
  sceneId?: string
  enableShadows?: boolean
  onProgress?: (progress: number, message: string) => void
}

export interface SceneBuildResult {
  scene: THREE_NS.Scene
  camera: THREE_NS.PerspectiveCamera
  cameraTarget: THREE_NS.Vector3
  mixers: THREE_NS.AnimationMixer[]
  statistics: {
    meshCount: number
    lightCount: number
    triangleCount: number
  }
  sceneName: string
}

export interface AssetSource {
  kind: 'arraybuffer' | 'data-url' | 'remote-url'
  data: ArrayBuffer | string
  contentType?: string | null
  name?: string | null
}

interface SceneBuilderContext {
  THREE: typeof THREE_NS
  canvas: any
  document: StoredSceneDocument
  options: SceneBuildOptions
}

class SceneBuilder {
  private readonly THREE: typeof THREE_NS
  private readonly canvas: any
  private readonly document: StoredSceneDocument
  private readonly options: SceneBuildOptions
  private readonly enableShadows: boolean

  private readonly scene: THREE_NS.Scene
  private camera: THREE_NS.PerspectiveCamera | null = null
  private cameraTarget: THREE_NS.Vector3
  private mixers: THREE_NS.AnimationMixer[] = []

  private readonly materialTemplates = new Map<string, THREE_NS.Material>()
  private readonly textureCache = new Map<string, THREE_NS.Texture>()
  private readonly gltfCache = new Map<string, THREE_NS.Object3D>()
  private readonly lightTargets: THREE_NS.Object3D[] = []

  private stats = {
    meshCount: 0,
    lightCount: 0,
    triangleCount: 0,
  }

  private hasDirectionalLight = false

  constructor(context: SceneBuilderContext) {
    this.THREE = context.THREE
    this.canvas = context.canvas
    this.document = context.document
    this.options = context.options
  this.enableShadows = context.options.enableShadows !== false
    this.scene = new this.THREE.Scene()
    this.scene.name = context.document.name ?? 'Scene'
    this.scene.background = new this.THREE.Color(DEFAULT_SCENE_BACKGROUND)
    const fog = new this.THREE.Fog(DEFAULT_SCENE_FOG_COLOR, 45, 320)
    this.scene.fog = fog
    this.cameraTarget = new this.THREE.Vector3()
  }

  async build(): Promise<SceneBuildResult> {
    this.prepareMaterialTemplates()
    await this.buildNodes(this.document.nodes, this.scene)
    this.ensureLighting()
    this.setupCamera(this.document.camera)
    this.scene.updateMatrixWorld(true)
    this.computeStatistics()

    const camera = this.createFallbackCamera()

    return {
      scene: this.scene,
      camera,
      cameraTarget: this.cameraTarget.clone(),
      mixers: this.mixers,
      statistics: { ...this.stats },
      sceneName: this.document.name ?? 'Scene',
    }
  }

  private prepareMaterialTemplates() {
    this.document.materials.forEach((material: SceneMaterial) => {
      const instance = this.instantiateMaterial(material)
      this.materialTemplates.set(material.id, instance)
    })
  }

  private async buildNodes(nodes: SceneNode[], parent: THREE_NS.Object3D) {
    for (const node of nodes) {
      const built = await this.buildSingleNode(node)
      if (!built) {
        continue
      }
      parent.add(built)
    }
  }

  private async buildSingleNode(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    switch (node.nodeType) {
      case 'Group':
        return this.buildGroupNode(node)
      case 'Light':
        return this.buildLightNode(node)
      case 'Camera':
        return this.buildCameraPlaceholder(node)
      case 'Mesh':
        return this.buildMeshNode(node)
      default:
        return this.buildPrimitiveNode(node)
    }
  }

  private async buildGroupNode(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    const group = new this.THREE.Group()
    group.name = node.name
    this.applyTransform(group, node)
    this.applyVisibility(group, node)
    if (node.children?.length) {
      await this.buildNodes(node.children, group)
    }
    return group
  }

  private applyVisibility(object: THREE_NS.Object3D, node: SceneNode) {
    if (typeof node.visible === 'boolean') {
      object.visible = node.visible
    }
  }

  private async buildLightNode(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    const lightProps = node.light
    if (!lightProps) {
      return null
    }

    const color = new this.THREE.Color(lightProps.color ?? '#ffffff')
    const intensity = Number.isFinite(lightProps.intensity) ? lightProps.intensity : 1
    let light: THREE_NS.Light | null = null

    switch (lightProps.type) {
      case 'Directional': {
        const dir = new this.THREE.DirectionalLight(color, intensity)
        dir.castShadow = !!lightProps.castShadow
        dir.shadow.mapSize.set(2048, 2048)
        dir.shadow.camera.near = 0.1
        dir.shadow.camera.far = 200
        dir.shadow.bias = -0.0002
        light = dir
        this.hasDirectionalLight = true
        break
      }
      case 'Point': {
        const point = new this.THREE.PointLight(color, intensity, lightProps.distance, lightProps.decay)
        point.castShadow = !!lightProps.castShadow
        light = point
        break
      }
      case 'Spot': {
        const spot = new this.THREE.SpotLight(color, intensity, lightProps.distance, lightProps.angle, lightProps.penumbra, lightProps.decay)
        spot.castShadow = !!lightProps.castShadow
        spot.shadow.mapSize.set(1024, 1024)
        light = spot
        break
      }
      case 'Ambient':
      default:
        light = new this.THREE.AmbientLight(color, intensity)
        break
    }

    if (!light) {
      return null
    }

    light.name = node.name
    this.applyTransform(light, node)
    this.applyVisibility(light, node)
    this.stats.lightCount += 1

    if ('target' in lightProps && lightProps.target) {
      const target = new this.THREE.Object3D()
      target.position.set(lightProps.target.x, lightProps.target.y, lightProps.target.z)
      this.scene.add(target)
      if ((light as THREE_NS.DirectionalLight | THREE_NS.SpotLight).target) {
        (light as THREE_NS.DirectionalLight | THREE_NS.SpotLight).target = target
      }
      this.lightTargets.push(target)
    }

    return light
  }

  private buildCameraPlaceholder(node: SceneNode): THREE_NS.Object3D {
    const helper = new this.THREE.Object3D()
    helper.name = node.name || 'Camera'
    this.applyTransform(helper, node)
    this.applyVisibility(helper, node)
    return helper
  }

  private async buildMeshNode(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    if (node.dynamicMesh?.type === 'Ground') {
      return this.buildGroundMesh(node.dynamicMesh, node)
    }

    if (node.dynamicMesh?.type === 'Wall') {
      return this.buildNodesForWall(node.dynamicMesh, node)
    }

    if (node.sourceAssetId) {
      const loaded = await this.loadAssetMesh(node)
      if (loaded) {
        this.applyTransform(loaded, node)
        this.applyVisibility(loaded, node)
        this.recordMeshStatistics(loaded)
        return loaded
      }
    }

    // Fallback to primitive box when source asset missing.
    return this.buildPrimitiveNode({ ...node, nodeType: 'Box' })
  }

  private async buildPrimitiveNode(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    const materials = this.resolveNodeMaterials(node)
    const mesh = this.createPrimitiveMesh(node.nodeType, materials)
    if (!mesh) {
      return null
    }
    mesh.name = node.name
    this.applyTransform(mesh, node)
    this.applyVisibility(mesh, node)
  mesh.castShadow = this.enableShadows
  mesh.receiveShadow = true
    this.stats.meshCount += 1
    this.stats.triangleCount += this.estimateGeometryTriangles(mesh.geometry)

    if (node.children?.length) {
      await this.buildNodes(node.children, mesh)
    }

    return mesh
  }

  private resolveNodeMaterials(node: SceneNode): THREE_NS.Material[] {
    if (!node.materials || !node.materials.length) {
      return [this.createDefaultMaterial('#ffffff')]
    }
    return node.materials.map((entry: SceneNodeMaterial) => this.createMaterialForNode(entry))
  }

  private createDefaultMaterial(colorHex: string): THREE_NS.Material {
    const material = new this.THREE.MeshStandardMaterial({
      color: new this.THREE.Color(colorHex),
      metalness: 0.2,
      roughness: 0.7,
    })
    material.side = this.THREE.DoubleSide
    return material
  }

  private createMaterialForNode(material: SceneNodeMaterial): THREE_NS.Material {
    if (material.materialId) {
      const template = this.materialTemplates.get(material.materialId)
      if (template) {
        const clone = template.clone()
        this.applyMaterialProps(clone, material)
        return clone
      }
    }
    const instance = this.instantiateMaterial(material)
    return instance
  }

  private instantiateMaterial(material: SceneMaterial | SceneNodeMaterial): THREE_NS.Material {
    const type = material.type ?? 'MeshStandardMaterial'
    const props = this.extractMaterialProps(material)
    const side = this.resolveMaterialSide(props.side)
    const color = new this.THREE.Color(props.color)
    const emissiveColor = new this.THREE.Color(props.emissive ?? '#000000')

    switch (type) {
      case 'MeshBasicMaterial': {
        const parameters: THREE_NS.MeshBasicMaterialParameters = {
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshBasicMaterial(parameters)
      }
      case 'MeshLambertMaterial': {
        const parameters: THREE_NS.MeshLambertMaterialParameters = {
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshLambertMaterial(parameters)
      }
      case 'MeshPhongMaterial': {
        const parameters: THREE_NS.MeshPhongMaterialParameters = {
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshPhongMaterial(parameters)
      }
      case 'MeshToonMaterial': {
        const parameters: THREE_NS.MeshToonMaterialParameters = {
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshToonMaterial(parameters)
      }
      case 'MeshNormalMaterial': {
        const parameters: THREE_NS.MeshNormalMaterialParameters = {
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshNormalMaterial(parameters)
      }
      case 'MeshPhysicalMaterial': {
        const parameters: THREE_NS.MeshPhysicalMaterialParameters = {
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          envMapIntensity: props.envMapIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshPhysicalMaterial(parameters)
      }
      case 'MeshMatcapMaterial': {
        const parameters: THREE_NS.MeshMatcapMaterialParameters = {
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          side,
        }
        return new this.THREE.MeshMatcapMaterial(parameters)
      }
      case 'MeshStandardMaterial':
      default: {
        const parameters: THREE_NS.MeshStandardMaterialParameters = {
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          envMapIntensity: props.envMapIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        }
        return new this.THREE.MeshStandardMaterial(parameters)
      }
    }
  }

  private extractMaterialProps(material: SceneMaterial | SceneNodeMaterial): SceneMaterialProps {
    const { color, transparent, opacity, side, wireframe, metalness, roughness, emissive, emissiveIntensity, aoStrength, envMapIntensity, textures } = material
    return {
      color: color ?? '#ffffff',
      transparent: transparent ?? false,
      opacity: opacity ?? 1,
      side: side ?? 'front',
      wireframe: wireframe ?? false,
      metalness: metalness ?? 0.2,
      roughness: roughness ?? 0.7,
      emissive: emissive ?? '#000000',
      emissiveIntensity: emissiveIntensity ?? 0,
      aoStrength: aoStrength ?? 1,
      envMapIntensity: envMapIntensity ?? 1,
      textures: textures ?? {},
    }
  }

  private resolveMaterialSide(side: SceneMaterialProps['side']): THREE_NS.Side {
    switch (side) {
      case 'double':
        return this.THREE.DoubleSide
      case 'back':
        return this.THREE.BackSide
      case 'front':
      default:
        return this.THREE.FrontSide
    }
  }

  private applyMaterialProps(material: THREE_NS.Material, props: SceneMaterialProps) {
    material.transparent = props.transparent ?? material.transparent
    material.opacity = props.opacity ?? material.opacity
    material.side = this.resolveMaterialSide(props.side)
    if (props.color && 'color' in material && (material as any).color) {
      (material as any).color = new this.THREE.Color(props.color)
    }
    if ('emissive' in material && (material as any).emissive) {
      (material as any).emissive = new this.THREE.Color(props.emissive ?? '#000000')
      if ('emissiveIntensity' in material) {
        (material as any).emissiveIntensity = props.emissiveIntensity ?? (material as any).emissiveIntensity
      }
    }
    if ('wireframe' in material) {
      (material as any).wireframe = props.wireframe ?? (material as any).wireframe
    }
    if (material instanceof this.THREE.MeshStandardMaterial) {
      material.metalness = props.metalness ?? material.metalness
      material.roughness = props.roughness ?? material.roughness
      material.envMapIntensity = props.envMapIntensity ?? material.envMapIntensity
    }
    material.needsUpdate = true
  }

  private createPrimitiveMesh(type: SceneNode['nodeType'], materials: THREE_NS.Material[]): THREE_NS.Mesh | null {
    const geometry = this.createGeometry(type)
    if (!geometry) {
      return null
    }
    const material = materials.length === 1 ? materials[0] : materials
    return new this.THREE.Mesh(geometry, material)
  }

  private createGeometry(type: SceneNode['nodeType']): THREE_NS.BufferGeometry | null {
    const THREE = this.THREE
    switch (type) {
      case 'Box':
        return new THREE.BoxGeometry(1, 1, 1)
      case 'Sphere':
        return new THREE.SphereGeometry(0.5, 32, 16)
      case 'Capsule':
        return new THREE.CapsuleGeometry(0.3, 0.8, 8, 16)
      case 'Circle':
        return new THREE.CircleGeometry(0.5, 32)
      case 'Cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32)
      case 'Dodecahedron':
        return new THREE.DodecahedronGeometry(0.6, 0)
      case 'Icosahedron':
        return new THREE.IcosahedronGeometry(0.6, 0)
      case 'Lathe': {
        const points: THREE_NS.Vector2[] = []
        for (let i = 0; i < 10; i += 1) {
          points.push(new THREE.Vector2(Math.sin(i * 0.2) * 0.5 + 0.5, (i - 5) * 0.2))
        }
        return new THREE.LatheGeometry(points, 24)
      }
      case 'Octahedron':
        return new THREE.OctahedronGeometry(0.6, 0)
      case 'Plane':
        return new THREE.PlaneGeometry(1, 1, 1, 1)
      case 'Ring':
        return new THREE.RingGeometry(0.3, 0.6, 32)
      case 'Torus':
        return new THREE.TorusGeometry(0.5, 0.2, 16, 64)
      case 'TorusKnot':
        return new THREE.TorusKnotGeometry(0.4, 0.15, 120, 12)
      default:
        return new THREE.BoxGeometry(1, 1, 1)
    }
  }

  private estimateGeometryTriangles(geometry: THREE_NS.BufferGeometry): number {
    if (!geometry) {
      return 0
    }
    if (geometry.index) {
      return geometry.index.count / 3
    }
    if (geometry.attributes?.position) {
      return geometry.attributes.position.count / 3
    }
    return 0
  }

  private recordMeshStatistics(object: THREE_NS.Object3D | null) {
    if (!object) {
      return
    }
    object.traverse((child: THREE_NS.Object3D) => {
      const mesh = child as THREE_NS.Mesh
      if ((mesh as any)?.isMesh && mesh.geometry) {
        this.stats.meshCount += 1
        const geometry = mesh.geometry as THREE_NS.BufferGeometry
        this.stats.triangleCount += this.estimateGeometryTriangles(geometry)
      }
    })
  }

  private applyTransform(object: THREE_NS.Object3D, node: SceneNode) {
    if (node.position) {
      object.position.set(node.position.x, node.position.y, node.position.z)
    }
    if (node.rotation) {
      object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
    }
    if (node.scale) {
      object.scale.set(node.scale.x, node.scale.y, node.scale.z)
    }
  }

  private async buildNodesForDynamicChildren(parentNode: SceneNode, object: THREE_NS.Object3D) {
    if (parentNode.children?.length) {
      await this.buildNodes(parentNode.children, object)
    }
  }

  private async loadAssetMesh(node: SceneNode): Promise<THREE_NS.Object3D | null> {
    const assetId = node.sourceAssetId!
    const cached = this.gltfCache.get(assetId)
    if (cached) {
      return cached.clone(true)
    }

    const source = await this.resolveAssetSource(assetId)
    if (!source) {
      console.warn('未找到资源数据', assetId)
      return null
    }

    let arrayBuffer: ArrayBuffer | null = null

    switch (source.kind) {
      case 'arraybuffer':
        arrayBuffer = source.data as ArrayBuffer
        break
      case 'data-url':
        arrayBuffer = this.decodeDataUrl(source.data as string)
        break
      case 'remote-url':
        arrayBuffer = await this.downloadArrayBuffer(source.data as string)
        break
      default:
        arrayBuffer = null
    }

    if (!arrayBuffer) {
      console.warn('资源数据为空', assetId)
      return null
    }

    const gltfRoot = await this.parseGltf(arrayBuffer)
    if (!gltfRoot) {
      console.warn('GLTF 解析失败', assetId)
      return null
    }

    this.prepareImportedObject(gltfRoot)
    this.gltfCache.set(assetId, gltfRoot)
    return gltfRoot.clone(true)
  }

  private prepareImportedObject(object: THREE_NS.Object3D) {
    object.traverse((child) => {
      const mesh = child as THREE_NS.Mesh
      if ((mesh as any).isMesh) {
        mesh.castShadow = this.enableShadows
        mesh.receiveShadow = true
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => (mat as THREE_NS.Material).side = this.THREE.DoubleSide)
        } else if (mesh.material) {
          (mesh.material as THREE_NS.Material).side = this.THREE.DoubleSide
        }
      }
    })
  }

  private async parseGltf(buffer: ArrayBuffer): Promise<THREE_NS.Object3D | null> {
    const loaderCtor = (this.THREE as unknown as { GLTFLoader?: new () => any }).GLTFLoader
    if (!loaderCtor) {
      console.warn('GLTFLoader 未注册，无法解析模型')
      return null
    }
    const loader = new loaderCtor()
    return new Promise<THREE_NS.Object3D | null>((resolve) => {
      loader.parse(
        buffer,
        '',
        (gltf: GLTF) => {
          resolve(gltf.scene ?? null)
        },
        (error: unknown) => {
          console.error('GLTF 解析错误', error)
          resolve(null)
        },
      )
    })
  }

  private decodeDataUrl(dataUrl: string): ArrayBuffer {
    const [, base64] = dataUrl.split(',')
    const clean = base64 ?? ''
    if (WX?.base64ToArrayBuffer) {
      return WX.base64ToArrayBuffer(clean)
    }
    const globalObj = globalThis as Record<string, unknown>
    const bufferFactory = globalObj.Buffer as
      | { from: (input: string, encoding: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number } }
      | undefined
    if (bufferFactory?.from) {
      const buffer = bufferFactory.from(clean, 'base64')
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
    const atobCandidate = (globalObj as { atob?: unknown }).atob
    const globalAtob = typeof atobCandidate === 'function'
      ? (atobCandidate as (value: string) => string)
      : null
    if (!globalAtob) {
      throw new Error('当前环境无法解析数据 URL')
    }
    const binary = globalAtob(clean)
    const length = binary.length
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  private downloadArrayBuffer(url: string): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      if (!WX?.request) {
        reject(new Error('wx.request 不可用'))
        return
      }
      WX.request({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        success: (res: { statusCode: number; data?: ArrayBuffer }) => {
          const { statusCode, data } = res
          if (statusCode === 200 && data instanceof ArrayBuffer) {
            resolve(data)
            return
          }
          reject(new Error(`下载失败: ${statusCode}`))
        },
        fail: (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      })
    })
  }

  private async resolveAssetSource(assetId: string): Promise<AssetSource | null> {
    const packageMap = this.document.packageAssetMap ?? {}
    const embeddedKey = `${LOCAL_ASSET_PREFIX}${assetId}`
    if (packageMap[embeddedKey]) {
      return { kind: 'data-url', data: packageMap[embeddedKey] }
    }

    const directKey = packageMap[assetId]
    if (directKey && packageMap[`${LOCAL_ASSET_PREFIX}${directKey}`]) {
      return { kind: 'data-url', data: packageMap[`${LOCAL_ASSET_PREFIX}${directKey}`] }
    }

    const asset = this.findAssetInCatalog(assetId)
    if (asset?.downloadUrl) {
      return { kind: 'remote-url', data: asset.downloadUrl, name: asset.name, contentType: null }
    }

    return null
  }

  private findAssetInCatalog(assetId: string) {
    const catalog = this.document.assetCatalog ?? {}
    for (const list of Object.values(catalog)) {
      if (!Array.isArray(list)) {
        continue
      }
      const assetList = list as ProjectAsset[]
      const found = assetList.find((entry: ProjectAsset) => entry.id === assetId)
      if (found) {
        return found
      }
    }
    return null
  }

  private async buildGroundMesh(mesh: GroundDynamicMesh, node: SceneNode): Promise<THREE_NS.Object3D> {
    const geometry = new this.THREE.PlaneGeometry(mesh.width, mesh.depth, mesh.columns, mesh.rows)
    geometry.rotateX(-Math.PI / 2)
    const materials = this.resolveNodeMaterials(node)
    const ground = new this.THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0])
  ground.receiveShadow = this.enableShadows
  ground.castShadow = false
    ground.name = node.name || 'Ground'
    this.applyTransform(ground, node)
    this.applyVisibility(ground, node)
    this.stats.meshCount += 1
    this.stats.triangleCount += this.estimateGeometryTriangles(geometry)

    await this.buildNodesForDynamicChildren(node, ground)

    return ground
  }

  private async buildNodesForWall(mesh: WallDynamicMesh, node: SceneNode): Promise<THREE_NS.Object3D> {
    const container = new this.THREE.Group()
    container.name = node.name || 'Wall'
    mesh.segments.forEach((segment, index) => {
      const length = Math.sqrt(
        (segment.end.x - segment.start.x) ** 2 +
        (segment.end.y - segment.start.y) ** 2 +
        (segment.end.z - segment.start.z) ** 2,
      )
      const geometry = new this.THREE.BoxGeometry(length, segment.height, segment.thickness)
      const materials = this.resolveNodeMaterials(node)
      const wallSegment = new this.THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0])
  wallSegment.castShadow = this.enableShadows
      wallSegment.receiveShadow = true
      wallSegment.name = `${node.name || 'Wall'}-${index}`

      const midPoint = {
        x: (segment.start.x + segment.end.x) / 2,
        y: segment.height / 2,
        z: (segment.start.z + segment.end.z) / 2,
      }
      wallSegment.position.set(midPoint.x, midPoint.y, midPoint.z)
      wallSegment.lookAt(segment.end.x, midPoint.y, segment.end.z)

      container.add(wallSegment)
      this.stats.meshCount += 1
      this.stats.triangleCount += this.estimateGeometryTriangles(geometry)
    })

    await this.buildNodesForDynamicChildren(node, container)

    this.applyTransform(container, node)
    this.applyVisibility(container, node)

    return container
  }

  private ensureLighting() {
    if (!this.hasDirectionalLight) {
      const dir = new this.THREE.DirectionalLight('#ffffff', 0.8)
      dir.position.set(18, 32, 18)
      dir.castShadow = this.enableShadows
      dir.shadow.mapSize.set(1024, 1024)
      this.scene.add(dir)
      const target = new this.THREE.Object3D()
      target.position.set(0, 0, 0)
      this.scene.add(target)
      dir.target = target
      this.lightTargets.push(target)
    }

    const ambient = new this.THREE.AmbientLight('#404040', 0.4)
    this.scene.add(ambient)
  }

  private setupCamera(cameraState: SceneCameraState) {
    const fov = cameraState?.fov ?? 50
    const aspect = 1
    const near = 0.1
    const far = 500
    this.camera = new this.THREE.PerspectiveCamera(fov, aspect, near, far)
    this.camera.position.set(cameraState.position.x, cameraState.position.y, cameraState.position.z)
    this.cameraTarget.set(cameraState.target.x, cameraState.target.y, cameraState.target.z)
    this.camera.lookAt(this.cameraTarget)
    this.scene.add(this.camera)
  }

  private createFallbackCamera(): THREE_NS.PerspectiveCamera {
    const camera = new this.THREE.PerspectiveCamera(50, 1, 0.1, 500)
    camera.position.set(12, 12, 12)
    camera.lookAt(new this.THREE.Vector3(0, 0, 0))
    this.scene.add(camera)
    return camera
  }

  private computeStatistics() {
    const box = new this.THREE.Box3().setFromObject(this.scene)
    if (!box.isEmpty()) {
      const size = new this.THREE.Vector3()
      box.getSize(size)
      if (this.camera && size.length() > 0) {
        const distance = size.length() * 1.2
        this.camera.far = Math.max(this.camera.far, distance * 2)
        this.camera.updateProjectionMatrix()
      }
    }
  }
}

export function parseSceneBundle(source: string | object): StoredSceneDocument {
  if (typeof source === 'string') {
    return JSON.parse(source) as StoredSceneDocument
  }
  return source as StoredSceneDocument
}

export async function buildSceneFromBundle(
  THREE: typeof THREE_NS,
  canvas: any,
  bundle: StoredSceneDocument,
  options: SceneBuildOptions = {},
): Promise<SceneBuildResult> {
  const builder = new SceneBuilder({ THREE, canvas, document: bundle, options })
  return builder.build()
}
