import * as THREE from 'three'
import { resolveOriginalMaterial } from './materialState'

const MAX_TRIANGLE_SAMPLES = 6000
const MAX_SKIN_SAMPLES = 2000

export type Vec3Tuple = [number, number, number]

export type BoxInfo = {
  min: Vec3Tuple
  max: Vec3Tuple
  size: Vec3Tuple
  center: Vec3Tuple
  maxDimension: number
}

export type SceneStats = {
  meshCount: number
  skinnedMeshCount: number
  vertices: number
  triangles: number
  materialCount: number
  textureCount: number
  boneCount: number
  animationCount: number
  morphTargetCount: number
  issueCount: number
}

export type NodeRow = {
  index: number
  depth: number
  name: string
  type: string
  visible: boolean
  isMesh: boolean
}

export type TextureInfo = {
  meshName: string
  materialName: string
  slot: string
  name: string
  dimensions: string
  colorSpace: string
  wrap: string
  filter: string
  channel: number
  loaded: boolean
}

export type MaterialInfo = {
  key: string
  name: string
  type: string
  side: string
  sourceSide: string | null
  transparent: boolean
  opacity: number
  alphaTest: number
  depthWrite: boolean
  toneMapped: boolean
  wireframe: boolean
  flatShading: string
  metalness: string
  roughness: string
  emissive: string
  vertexColors: boolean
  meshCount: number
  textures: TextureInfo[]
}

export type IssueLevel = 'error' | 'warn' | 'info'

export type IssueNodeRef = {
  index: number
  name: string
}

export type Issue = {
  code: string
  level: IssueLevel
  title: string
  detail: string
  nodes: IssueNodeRef[]
}

export type AnimationInfo = {
  name: string
  duration: number
  trackCount: number
  targetNames: string[]
}

export type InspectionResult = {
  stats: SceneStats
  bounds: BoxInfo | null
  nodes: NodeRow[]
  materials: MaterialInfo[]
  textures: TextureInfo[]
  animations: AnimationInfo[]
  issues: Issue[]
}

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
] as const

function isRenderableMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh & { isSkinnedMesh?: boolean }
  return Boolean(mesh.isMesh || mesh.isSkinnedMesh)
}

function materialList(material: THREE.Material | THREE.Material[] | null | undefined): THREE.Material[] {
  if (!material) {
    return []
  }
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Number.parseFloat(value.toFixed(digits))
}

function toTuple(vector: THREE.Vector3): Vec3Tuple {
  return [round(vector.x), round(vector.y), round(vector.z)]
}

function describeSide(side: THREE.Side): string {
  if (side === THREE.DoubleSide) {
    return 'DoubleSide'
  }
  if (side === THREE.BackSide) {
    return 'BackSide'
  }
  return 'FrontSide'
}

function describeWrapping(wrap: THREE.Wrapping): string {
  if (wrap === THREE.RepeatWrapping) {
    return 'Repeat'
  }
  if (wrap === THREE.MirroredRepeatWrapping) {
    return 'MirroredRepeat'
  }
  return 'ClampToEdge'
}

function describeFilter(filter: THREE.MinificationTextureFilter | THREE.MagnificationTextureFilter): string {
  if (filter === THREE.NearestFilter) {
    return 'Nearest'
  }
  if (filter === THREE.NearestMipmapNearestFilter) {
    return 'NearestMipmapNearest'
  }
  if (filter === THREE.NearestMipmapLinearFilter) {
    return 'NearestMipmapLinear'
  }
  if (filter === THREE.LinearFilter) {
    return 'Linear'
  }
  if (filter === THREE.LinearMipmapNearestFilter) {
    return 'LinearMipmapNearest'
  }
  if (filter === THREE.LinearMipmapLinearFilter) {
    return 'LinearMipmapLinear'
  }
  return String(filter)
}

function readMaterialUserData(material: THREE.Material, key: string): unknown {
  return (material.userData as Record<string, unknown> | undefined)?.[key]
}

/** The material's side before the "force FrontSide" comparison toggle rewrote it, when known. */
function resolveSourceSide(material: THREE.Material): THREE.Side | null {
  const value = readMaterialUserData(material, '__inspectSourceSide')
  return typeof value === 'number' ? (value as THREE.Side) : null
}

function imageDimensions(texture: THREE.Texture): { width: number; height: number } | null {
  const image = texture.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined
  if (!image) {
    return null
  }
  const width = Number(image.width ?? image.videoWidth ?? 0)
  const height = Number(image.height ?? image.videoHeight ?? 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

function usesMipmap(filter: THREE.MinificationTextureFilter): boolean {
  return filter !== THREE.NearestFilter && filter !== THREE.LinearFilter
}

function isTextureLoaded(texture: THREE.Texture): boolean {
  return Boolean((texture as unknown as { image?: unknown }).image)
}

function readMaterialProperty(material: THREE.Material, key: string): unknown {
  return (material as unknown as Record<string, unknown>)[key]
}

function formatMaterialNumber(material: THREE.Material, key: string): string {
  const value = readMaterialProperty(material, key)
  return typeof value === 'number' ? String(round(value)) : '—'
}

function formatEmissive(material: THREE.Material): string {
  const emissive = readMaterialProperty(material, 'emissive') as THREE.Color | undefined
  if (!emissive) {
    return '—'
  }
  return `#${emissive.getHexString()}`
}

type TraversalEntry = {
  object: THREE.Object3D
  index: number
  depth: number
}

function collectTraversal(root: THREE.Object3D): TraversalEntry[] {
  const entries: TraversalEntry[] = []
  let index = 0
  const walk = (object: THREE.Object3D, depth: number): void => {
    entries.push({ object, index, depth })
    index += 1
    for (const child of object.children) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return entries
}

function boundsOfObject(object: THREE.Object3D): BoxInfo | null {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    return null
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return {
    min: toTuple(box.min),
    max: toTuple(box.max),
    size: toTuple(size),
    center: toTuple(center),
    maxDimension: round(Math.max(size.x, size.y, size.z)),
  }
}

type TriangleScan = {
  triangleCount: number
  sampledTriangles: number
  degenerateTriangles: number
  flippedTriangles: number
  normalSamples: number
}

function scanTriangles(geometry: THREE.BufferGeometry): TriangleScan | null {
  const position = geometry.getAttribute('position')
  if (!position) {
    return null
  }
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const triangleCount = index
    ? Math.floor(index.count / 3)
    : Math.floor(position.count / 3)
  if (triangleCount <= 0) {
    return { triangleCount: 0, sampledTriangles: 0, degenerateTriangles: 0, flippedTriangles: 0, normalSamples: 0 }
  }

  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere()
  }
  const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1e-3)
  const areaThreshold = radius * radius * 1e-9

  const step = Math.max(1, Math.floor(triangleCount / MAX_TRIANGLE_SAMPLES))
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  const vertexNormal = new THREE.Vector3()
  const scratch = new THREE.Vector3()

  let sampledTriangles = 0
  let degenerateTriangles = 0
  let flippedTriangles = 0
  let normalSamples = 0

  const readVector = (
    target: THREE.Vector3,
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    vertexIndex: number,
  ): void => {
    target.set(attribute.getX(vertexIndex), attribute.getY(vertexIndex), attribute.getZ(vertexIndex))
  }

  for (let triangle = 0; triangle < triangleCount; triangle += step) {
    const base = triangle * 3
    const i0 = index ? index.getX(base) : base
    const i1 = index ? index.getX(base + 1) : base + 1
    const i2 = index ? index.getX(base + 2) : base + 2
    if (i0 >= position.count || i1 >= position.count || i2 >= position.count) {
      continue
    }
    readVector(a, position, i0)
    readVector(b, position, i1)
    readVector(c, position, i2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    faceNormal.crossVectors(ab, ac)
    const doubleArea = faceNormal.length()
    sampledTriangles += 1
    if (doubleArea <= areaThreshold) {
      degenerateTriangles += 1
      continue
    }
    if (!normal) {
      continue
    }
    faceNormal.divideScalar(doubleArea)
    vertexNormal.set(0, 0, 0)
    readVector(scratch, normal, i0)
    vertexNormal.add(scratch)
    readVector(scratch, normal, i1)
    vertexNormal.add(scratch)
    readVector(scratch, normal, i2)
    vertexNormal.add(scratch)
    if (vertexNormal.lengthSq() <= 1e-12) {
      continue
    }
    normalSamples += 1
    if (faceNormal.dot(vertexNormal) < 0) {
      flippedTriangles += 1
    }
  }

  return { triangleCount, sampledTriangles, degenerateTriangles, flippedTriangles, normalSamples }
}

function scanSkinWeights(mesh: THREE.SkinnedMesh): { checked: number; invalid: number; missingAttributes: boolean } {
  const geometry = mesh.geometry
  const skinWeight = geometry.getAttribute('skinWeight')
  const skinIndex = geometry.getAttribute('skinIndex')
  if (!skinWeight || !skinIndex) {
    return { checked: 0, invalid: 0, missingAttributes: true }
  }
  const step = Math.max(1, Math.floor(skinWeight.count / MAX_SKIN_SAMPLES))
  let checked = 0
  let invalid = 0
  for (let vertex = 0; vertex < skinWeight.count; vertex += step) {
    const sum = skinWeight.getX(vertex) + skinWeight.getY(vertex) + skinWeight.getZ(vertex) + skinWeight.getW(vertex)
    checked += 1
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.02) {
      invalid += 1
    }
  }
  return { checked, invalid, missingAttributes: false }
}

export function inspectScene(root: THREE.Object3D, animations: THREE.AnimationClip[] = []): InspectionResult {
  const traversal = collectTraversal(root)
  const nodes: NodeRow[] = traversal.map((entry) => ({
    index: entry.index,
    depth: entry.depth,
    name: entry.object.name || `(未命名 ${entry.object.type})`,
    type: entry.object.type,
    visible: entry.object.visible,
    isMesh: isRenderableMesh(entry.object),
  }))

  const materialsByKey = new Map<string, MaterialInfo>()
  const textures: TextureInfo[] = []
  const seenTextures = new Set<string>()
  const issues: Issue[] = []

  let meshCount = 0
  let skinnedMeshCount = 0
  let vertices = 0
  let triangles = 0
  let morphTargetCount = 0
  let boneCount = 0

  const addIssue = (
    code: string,
    level: IssueLevel,
    title: string,
    detail: string,
    entry?: TraversalEntry,
  ): void => {
    const existing = issues.find((issue) => issue.code === code && issue.title === title)
    const nodeRef = entry ? { index: entry.index, name: entry.object.name || entry.object.type } : null
    if (existing) {
      if (nodeRef && !existing.nodes.some((node) => node.index === nodeRef.index)) {
        existing.nodes.push(nodeRef)
      }
      return
    }
    issues.push({ code, level, title, detail, nodes: nodeRef ? [nodeRef] : [] })
  }

  for (const entry of traversal) {
    const object = entry.object
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedMeshCount += 1
      const skeleton = (object as THREE.SkinnedMesh).skeleton
      boneCount = Math.max(boneCount, skeleton?.bones?.length ?? 0)
    }
    if (!isRenderableMesh(object)) {
      continue
    }

    const mesh = object as THREE.Mesh
    meshCount += 1
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry) {
      addIssue('geometry-missing', 'error', '网格没有几何体', '该 mesh 的 geometry 为空，渲染时会直接跳过。', entry)
      continue
    }

    const position = geometry.getAttribute('position')
    if (!position) {
      addIssue('position-missing', 'error', '几何缺少 position 属性', '没有顶点位置数据，无法渲染。', entry)
      continue
    }
    vertices += position.count

    const scan = scanTriangles(geometry)
    if (scan) {
      triangles += scan.triangleCount
      if (scan.triangleCount === 0) {
        addIssue('geometry-empty', 'warn', '几何没有三角面', '顶点存在但没有组成三角面。', entry)
      }
      if (scan.degenerateTriangles > 0) {
        addIssue(
          'degenerate-triangles',
          scan.degenerateTriangles > scan.sampledTriangles * 0.05 ? 'warn' : 'info',
          '存在退化三角面',
          `抽样 ${scan.sampledTriangles} 个三角面中有 ${scan.degenerateTriangles} 个面积接近 0，可能出现黑面、裂缝或阴影像素。`,
          entry,
        )
      }
      if (scan.normalSamples > 0 && scan.flippedTriangles > scan.normalSamples * 0.6) {
        addIssue(
          'flipped-winding',
          'warn',
          '三角形绕序与顶点法线相反（背面朝外）',
          `${scan.normalSamples} 个可判定三角面中有 ${scan.flippedTriangles} 个的绕序与顶点法线相反；单面（FrontSide）材质下这类面会被剔除而显示为镂空，双面材质不受影响。`,
          entry,
        )
      }
    }

    const morphTargets = geometry.morphAttributes?.position?.length ?? 0
    if (morphTargets > 0) {
      morphTargetCount += morphTargets
      addIssue('morph-targets', 'info', '包含 morph target', `该网格有 ${morphTargets} 个 morph target，需要动画驱动才会变形。`, entry)
    }

    const materials = materialList(resolveOriginalMaterial(mesh))
    if (!materials.length) {
      addIssue(
        'material-missing',
        'info',
        '网格没有材质',
        '引擎导入时会给没有材质的网格套上 UV 调试材质，因此线上看到的方块图案来自引擎兜底。',
        entry,
      )
    }

    const hasUv = Boolean(geometry.getAttribute('uv'))
    const hasUv1 = Boolean(geometry.getAttribute('uv1'))
    const hasNormal = Boolean(geometry.getAttribute('normal'))
    const hasVertexColor = Boolean(geometry.getAttribute('color'))

    for (const material of materials) {
      const key = material.uuid
      let info = materialsByKey.get(key)
      if (!info) {
        info = {
          key,
          name: material.name || material.type,
          type: material.type,
          side: describeSide(material.side),
          sourceSide: resolveSourceSide(material) !== null ? describeSide(resolveSourceSide(material) as THREE.Side) : null,
          transparent: material.transparent,
          opacity: round(material.opacity),
          alphaTest: round(material.alphaTest),
          depthWrite: material.depthWrite,
          toneMapped: material.toneMapped,
          wireframe: Boolean(readMaterialProperty(material, 'wireframe')),
          flatShading: String(readMaterialProperty(material, 'flatShading') ?? '—'),
          metalness: formatMaterialNumber(material, 'metalness'),
          roughness: formatMaterialNumber(material, 'roughness'),
          emissive: formatEmissive(material),
          vertexColors: Boolean(readMaterialProperty(material, 'vertexColors')),
          meshCount: 0,
          textures: [],
        }
        materialsByKey.set(key, info)
      }
      info.meshCount += 1

      const sourceSide = resolveSourceSide(material)
      if (readMaterialUserData(material, '__inspectForcedFrontSide') === true && sourceSide !== null) {
        addIssue(
          'engine-forced-front-side',
          'warn',
          `材质 ${info.name} 已被强制为 FrontSide（原始 ${describeSide(sourceSide)}）`,
          `文件里 side = ${describeSide(sourceSide)}，"强制 FrontSide" 这个对照开关把它改成了单面；背向相机或法线朝内的面会变成镂空。取消勾选即可回到线上引擎行为。`,
          entry,
        )
      } else if (material.side !== THREE.FrontSide) {
        const side = describeSide(material.side)
        addIssue(
          'file-side-preserved',
          'info',
          `材质 ${info.name} 是 ${side}，引擎会原样保留`,
          `文件里 side = ${side}；引擎导入不再改写材质 side，文字、薄片、负向缩放或法线朝内的面会正常显示。`,
          entry,
        )
      }

      if (readMaterialUserData(material, '__scatterCutoutApplied') === true) {
        addIssue(
          'engine-alpha-cutout-applied',
          'info',
          `材质 ${info.name} 已被引擎转成 cutout`,
          '引擎的 alpha 规范化把它从 alpha 混合改成 alphaTest = 0.5 的 cutout：不会再半透明，边缘过渡消失，但遮挡关系更正常。',
          entry,
        )
      } else if (
        material.transparent &&
        material.opacity >= 0.98 &&
        material.alphaTest === 0 &&
        (readMaterialProperty(material, 'map') || readMaterialProperty(material, 'alphaMap'))
      ) {
        addIssue(
          'engine-alpha-cutout',
          'info',
          `材质 ${info.name} 会被引擎转成 cutout`,
          '引擎的 alpha 规范化会把「alpha 混合且不透明、带贴图」的材质改成 alphaTest = 0.5 的 cutout；透明边缘的过渡会消失。',
          entry,
        )
      }

      const normalMap = readMaterialProperty(material, 'normalMap')
      if (normalMap && (!hasNormal || !hasUv)) {
        addIssue(
          'normal-map-without-basis',
          'error',
          `材质 ${info.name} 使用法线贴图但缺少法线或 UV`,
          `geometry.normal = ${hasNormal}，geometry.uv = ${hasUv}；法线贴图无法正确计算，光照会出现块状或过亮。`,
          entry,
        )
      }

      if (!hasNormal && readMaterialProperty(material, 'map')) {
        addIssue(
          'normals-missing',
          'warn',
          '几何缺少法线属性',
          '缺少 normal 属性时 three.js 不会自动重算，光照与阴影会明显异常。',
          entry,
        )
      }

      for (const slot of TEXTURE_SLOTS) {
        const texture = readMaterialProperty(material, slot)
        if (!(texture instanceof THREE.Texture)) {
          continue
        }
        const dimensions = imageDimensions(texture)
        const loaded = isTextureLoaded(texture)
        const info2: TextureInfo = {
          meshName: mesh.name || mesh.type,
          materialName: info.name,
          slot,
          name: texture.name || texture.uuid.slice(0, 8),
          dimensions: dimensions ? `${dimensions.width}×${dimensions.height}` : '未知',
          colorSpace: texture.colorSpace || 'NoColorSpace',
          wrap: `${describeWrapping(texture.wrapS)} / ${describeWrapping(texture.wrapT)}`,
          filter: `${describeFilter(texture.magFilter)} / ${describeFilter(texture.minFilter)}`,
          channel: typeof texture.channel === 'number' ? texture.channel : 0,
          loaded,
        }
        const textureKey = `${info.key}:${slot}:${texture.uuid}`
        if (!seenTextures.has(textureKey)) {
          seenTextures.add(textureKey)
          info.textures.push(info2)
          textures.push(info2)
        }

        if (!hasUv && slot !== 'aoMap') {
          addIssue(
            'uv-missing',
            'error',
            '材质使用贴图但几何缺少 uv',
            `槽位 ${slot} 绑定了贴图，但几何没有 uv 属性，贴图无法映射（线上会看到纯色或拉伸）。`,
            entry,
          )
        }
        if (slot === 'aoMap' && info2.channel === 1 && !hasUv1) {
          addIssue(
            'uv1-missing-for-ao',
            'warn',
            'aoMap 使用 uv1 但几何没有 uv1',
            'three.js 的 aoMap 默认使用 uv1（第二套 UV）；缺少 uv1 时 AO 会读取错误坐标。',
            entry,
          )
        }
        if (!loaded) {
          addIssue(
            'texture-not-loaded',
            'error',
            `贴图未加载（${slot}）`,
            '贴图对象存在但没有图像数据，说明加载或解码失败；线上会退化成无贴图或白模。',
            entry,
          )
        }
        if (slot === 'map' && loaded && texture.colorSpace !== THREE.SRGBColorSpace) {
          addIssue(
            'albedo-color-space',
            'warn',
            'albedo 贴图未按 sRGB 解释',
            `map.colorSpace = ${texture.colorSpace || 'NoColorSpace'}；颜色会偏亮/偏灰，和制作软件不一致。`,
            entry,
          )
        }
        if (dimensions) {
          const isNpot = !isPowerOfTwo(dimensions.width) || !isPowerOfTwo(dimensions.height)
          const repeats = texture.wrapS === THREE.RepeatWrapping || texture.wrapT === THREE.RepeatWrapping
          if (isNpot && (repeats || usesMipmap(texture.minFilter))) {
            addIssue(
              'npot-texture',
              'info',
              'NPOT 贴图搭配 repeat / mipmap',
              `贴图尺寸 ${dimensions.width}×${dimensions.height} 不是 2 的幂，同时使用了 ${describeWrapping(texture.wrapS)} / mipmap；在 WebGL1 目标或部分小游戏环境下会失败或被强制降采样。`,
              entry,
            )
          }
        }
      }
    }

    if (hasVertexColor) {
      const usesVertexColor = materials.some((material) => Boolean(readMaterialProperty(material, 'vertexColors')))
      if (!usesVertexColor) {
        addIssue(
          'vertex-color-unused',
          'info',
          '几何带顶点色但材质未启用',
          'geometry 有 color 属性，但材质 vertexColors = false，顶点色不会显示。',
          entry,
        )
      }
    }

    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skin = scanSkinWeights(mesh as THREE.SkinnedMesh)
      if (skin.missingAttributes) {
        addIssue(
          'skin-attributes-missing',
          'error',
          '蒙皮网格缺少 skinIndex / skinWeight',
          '蒙皮属性缺失时模型会塌陷或停留在绑定姿势。',
          entry,
        )
      } else if (skin.invalid > 0) {
        addIssue(
          'skin-weight-sum',
          skin.invalid > skin.checked * 0.05 ? 'warn' : 'info',
          '骨骼权重和异常',
          `抽样 ${skin.checked} 个顶点中有 ${skin.invalid} 个权重和偏离 1（>0.02），可能出现撕裂或塌陷。`,
          entry,
        )
      }
    }
  }

  const bounds = boundsOfObject(root)
  if (bounds) {
    if (bounds.maxDimension <= 0) {
      addIssue('bounds-empty', 'warn', '包围盒为空', '模型没有任何有效几何尺寸。')
    } else if (bounds.maxDimension < 0.01) {
      addIssue('bounds-tiny', 'warn', '模型尺寸极小', `最大边长 ${bounds.maxDimension}，可能是单位换算（cm/m）或缩放错误。`)
    } else if (bounds.maxDimension > 5000) {
      addIssue('bounds-huge', 'warn', '模型尺寸极大', `最大边长 ${bounds.maxDimension}，相机与阴影范围会明显不匹配。`)
    }
  }

  const animationInfos: AnimationInfo[] = animations.map((clip) => ({
    name: clip.name || '(未命名动画)',
    duration: round(clip.duration, 3),
    trackCount: clip.tracks.length,
    targetNames: Array.from(new Set(clip.tracks.map((track) => track.name.split('.')[0] ?? track.name))).slice(0, 8),
  }))

  const levelOrder: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 }
  issues.sort((left, right) => levelOrder[left.level] - levelOrder[right.level])

  return {
    stats: {
      meshCount,
      skinnedMeshCount,
      vertices,
      triangles,
      materialCount: materialsByKey.size,
      textureCount: textures.length,
      boneCount,
      animationCount: animationInfos.length,
      morphTargetCount,
      issueCount: issues.length,
    },
    bounds,
    nodes,
    materials: [...materialsByKey.values()],
    textures,
    animations: animationInfos,
    issues,
  }
}

export function summarizeIssueCounts(issues: Issue[]): { error: number; warn: number; info: number } {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.level] += 1
      return counts
    },
    { error: 0, warn: 0, info: 0 },
  )
}
