import type {
  GltfParseAttributeDescriptor,
  GltfParseAnimationDescriptor,
  GltfParseDescriptor,
  GltfParseGeometryDescriptor,
  GltfParseMaterialDescriptor,
  GltfParseNodeDescriptor,
  GltfParseTextureDescriptor,
  GltfParseTrackDescriptor,
} from './gltfParseTypes'

// Worker-side serialization of an already-parsed THREE GLTF scene into the
// transferable descriptor. Written against structural types (no 'three' import)
// so the worker bundle stays small.

const SUPPORTED_MATERIAL_TYPES = new Set([
  'MeshStandardMaterial',
  'MeshBasicMaterial',
  'MeshPhongMaterial',
  'MeshLambertMaterial',
])

type Vec3Like = { x: number; y: number; z: number }
type QuatLike = { x: number; y: number; z: number; w: number }
type ColorLike = { r: number; g: number; b: number }
type BufferAttributeLike = { array: ArrayBufferView; itemSize: number; normalized: boolean }
type TextureLike = {
  image: unknown
  source?: { data?: unknown }
  wrapS: number
  wrapT: number
  flipY: boolean
  colorSpace: string
  magFilter: number
  minFilter: number
}
type MaterialLike = {
  type: string
  name: string
  color?: ColorLike
  emissive?: ColorLike
  roughness?: number
  metalness?: number
  opacity?: number
  transparent?: boolean
  side?: number
  alphaTest?: number
  flatShading?: boolean
  vertexColors?: boolean
  wireframe?: boolean
  emissiveIntensity?: number
  aoMapIntensity?: number
  normalScale?: { x: number; y: number }
  bumpScale?: number
  displacementScale?: number
  specular?: ColorLike
  shininess?: number
  envMap?: TextureLike | null
  lightMap?: TextureLike | null
  matcapMap?: TextureLike | null
  gradientMap?: TextureLike | null
  specularMap?: TextureLike | null
  sheen?: unknown
  clearcoat?: number
  clearcoatRoughness?: number
  transmission?: number
  iridescence?: number
  anisotropy?: number
  map?: TextureLike | null
  normalMap?: TextureLike | null
  roughnessMap?: TextureLike | null
  metalnessMap?: TextureLike | null
  emissiveMap?: TextureLike | null
  aoMap?: TextureLike | null
  alphaMap?: TextureLike | null
  bumpMap?: TextureLike | null
  displacementMap?: TextureLike | null
}
type GeometryLike = {
  attributes: Record<string, BufferAttributeLike | undefined>
  index: BufferAttributeLike | null | undefined
  morphAttributes: { position?: BufferAttributeLike[]; normal?: BufferAttributeLike[] }
}
type Object3DLike = {
  isSkinnedMesh?: boolean
  isMesh?: boolean
  material?: MaterialLike | MaterialLike[] | null
  geometry?: GeometryLike | null
  children: Object3DLike[]
  name: string
  position: Vec3Like
  quaternion: QuatLike
  scale: Vec3Like
  visible: boolean
  /** Clips attached to the object by GLTFLoader consumers (schema/loader.ts). */
  animations?: unknown
}

type AnimationClipLike = {
  name?: unknown
  duration?: unknown
  blendMode?: unknown
  tracks?: unknown
}

type KeyframeTrackLike = {
  name?: unknown
  ValueTypeName?: unknown
  DefaultInterpolation?: unknown
  times?: unknown
  values?: unknown
  getInterpolation?: () => unknown
}

/**
 * Track value types three can rebuild. Mirrors AnimationClip's own JSON value
 * type names (AnimationClip.getTrackTypeForValueTypeName).
 */
const NORMALIZED_TRACK_VALUE_TYPES: Record<string, string> = {
  scalar: 'number',
  double: 'number',
  float: 'number',
  number: 'number',
  vector: 'vector',
  vector2: 'vector',
  vector3: 'vector',
  vector4: 'vector',
  color: 'color',
  quaternion: 'quaternion',
  bool: 'boolean',
  boolean: 'boolean',
  string: 'string',
}

/**
 * THREE.InterpolateDiscrete / InterpolateLinear / InterpolateSmooth.
 *
 * KeyframeTrack.getInterpolation() reports these numeric constants, and a track
 * whose interpolation is anything else (e.g. GLTF CUBICSPLINE installs a custom
 * interpolant factory) would be rebuilt with different motion.
 */
const SUPPORTED_TRACK_INTERPOLATIONS = new Set([2300, 2301, 2302])

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength)
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return bytes.buffer
  }
  return new ArrayBuffer(0)
}

function serializeAttribute(attr: BufferAttributeLike, name: string): GltfParseAttributeDescriptor {
  const array = attr.array
  const bytes = array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength) as ArrayBuffer
  return {
    name,
    itemSize: attr.itemSize,
    normalized: attr.normalized === true,
    typedArrayType: array.constructor.name,
    bytes,
  }
}

function serializeGeometry(geometry: GeometryLike): GltfParseGeometryDescriptor {
  const attributes: GltfParseAttributeDescriptor[] = []
  for (const name of Object.keys(geometry.attributes)) {
    if (name === 'instanceMatrix' || name === 'instanceColor') {
      continue
    }
    const attr = geometry.attributes[name]
    if (attr) {
      attributes.push(serializeAttribute(attr, name))
    }
  }

  const index = geometry.index ? serializeAttribute(geometry.index, 'index') : null
  const morphPosition = geometry.morphAttributes.position
    ? geometry.morphAttributes.position.map((attr) => serializeAttribute(attr, 'morphPosition'))
    : null
  const morphNormal = geometry.morphAttributes.normal
    ? geometry.morphAttributes.normal.map((attr) => serializeAttribute(attr, 'morphNormal'))
    : null

  return { attributes, index, morphPosition, morphNormal }
}

async function extractTextureBytes(texture: TextureLike): Promise<GltfParseTextureDescriptor | null> {
  const image = texture.image
  const sourceData = texture.source?.data

  if (image == null && sourceData != null) {
    const bytes = toArrayBuffer(sourceData)
    if (bytes.byteLength > 0) {
      return {
        bytes,
        mimeType: 'application/octet-stream',
        wrapS: texture.wrapS,
        wrapT: texture.wrapT,
        flipY: texture.flipY,
        colorSpace: texture.colorSpace,
        magFilter: texture.magFilter,
        minFilter: texture.minFilter,
      }
    }
    return null
  }

  if (image != null && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bitmap = image as ImageBitmap
      const width = Math.max(1, Math.round(bitmap.width))
      const height = Math.max(1, Math.round(bitmap.height))
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) {
        return null
      }
      context.drawImage(bitmap, 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const bytes = await blob.arrayBuffer()
      return {
        bytes,
        mimeType: 'image/png',
        wrapS: texture.wrapS,
        wrapT: texture.wrapT,
        flipY: texture.flipY,
        colorSpace: texture.colorSpace,
        magFilter: texture.magFilter,
        minFilter: texture.minFilter,
      }
    } catch {
      return null
    }
  }

  return null
}

async function serializeMaterial(material: MaterialLike): Promise<GltfParseMaterialDescriptor | null> {
  const type = material.type
  if (!SUPPORTED_MATERIAL_TYPES.has(type)) {
    return null
  }

  // Conservative fidelity guard: fall back to the synchronous parse for
  // materials whose extra features this serializer does not reconstruct, rather
  // than silently rendering with wrong values.
  if (
    material.envMap
    || material.lightMap
    || material.matcapMap
    || material.gradientMap
    || material.specularMap
    || material.sheen != null
    || material.clearcoat != null
    || material.clearcoatRoughness != null
    || material.transmission != null
    || material.iridescence != null
    || material.anisotropy != null
  ) {
    return null
  }

  const color = material.color ?? { r: 1, g: 1, b: 1 }
  const emissive = material.emissive ?? { r: 0, g: 0, b: 0 }
  const specular = material.specular ?? { r: 1, g: 1, b: 1 }

  const slots: Array<[string, TextureLike | null | undefined]> = [
    ['map', material.map],
    ['normalMap', material.normalMap],
    ['roughnessMap', material.roughnessMap],
    ['metalnessMap', material.metalnessMap],
    ['emissiveMap', material.emissiveMap],
    ['aoMap', material.aoMap],
    ['alphaMap', material.alphaMap],
    ['bumpMap', material.bumpMap],
    ['displacementMap', material.displacementMap],
  ]

  const textures: Record<string, GltfParseTextureDescriptor | null> = {}
  for (const [slot, texture] of slots) {
    if (!texture) {
      textures[slot] = null
      continue
    }
    const descriptor = await extractTextureBytes(texture)
    if (!descriptor) {
      return null
    }
    textures[slot] = descriptor
  }

  return {
    name: material.name ?? '',
    type: type as GltfParseMaterialDescriptor['type'],
    color: [color.r, color.g, color.b],
    emissive: [emissive.r, emissive.g, emissive.b],
    roughness: material.roughness ?? 1,
    metalness: material.metalness ?? 0,
    opacity: material.opacity ?? 1,
    transparent: material.transparent === true,
    side: material.side ?? 0,
    alphaTest: material.alphaTest ?? 0,
    flatShading: material.flatShading === true,
    vertexColors: material.vertexColors === true,
    wireframe: material.wireframe === true,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    aoMapIntensity: material.aoMapIntensity ?? 1,
    normalScale: [material.normalScale?.x ?? 1, material.normalScale?.y ?? 1],
    bumpScale: material.bumpScale ?? 1,
    displacementScale: material.displacementScale ?? 1,
    specular: [specular.r, specular.g, specular.b],
    shininess: material.shininess ?? 30,
    map: textures.map ?? null,
    normalMap: textures.normalMap ?? null,
    roughnessMap: textures.roughnessMap ?? null,
    metalnessMap: textures.metalnessMap ?? null,
    emissiveMap: textures.emissiveMap ?? null,
    aoMap: textures.aoMap ?? null,
    alphaMap: textures.alphaMap ?? null,
    bumpMap: textures.bumpMap ?? null,
    displacementMap: textures.displacementMap ?? null,
  }
}

async function serializeNode(object: Object3DLike): Promise<GltfParseNodeDescriptor | null> {
  if (object.isSkinnedMesh === true) {
    return null
  }

  const isMesh = object.isMesh === true
  let geometry: GltfParseGeometryDescriptor | null = null
  let material: GltfParseMaterialDescriptor | null = null

  if (isMesh) {
    const meshMaterial = object.material ?? null
    if (Array.isArray(meshMaterial)) {
      return null
    }
    if (!object.geometry || !meshMaterial) {
      return null
    }
    const serializedMaterial = await serializeMaterial(meshMaterial)
    if (!serializedMaterial) {
      return null
    }
    geometry = serializeGeometry(object.geometry)
    material = serializedMaterial
  }

  const children: GltfParseNodeDescriptor[] = []
  for (const child of object.children) {
    const serializedChild = await serializeNode(child)
    if (!serializedChild) {
      return null
    }
    children.push(serializedChild)
  }

  return {
    name: object.name ?? '',
    position: [object.position.x, object.position.y, object.position.z],
    quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    scale: [object.scale.x, object.scale.y, object.scale.z],
    visible: object.visible !== false,
    isMesh,
    geometry,
    material,
    children,
  }
}

function serializeTrack(track: KeyframeTrackLike): GltfParseTrackDescriptor | null {
  const name = typeof track.name === 'string' ? track.name : ''
  if (!name) {
    return null
  }

  const valueTypeName = typeof track.ValueTypeName === 'string' ? track.ValueTypeName.toLowerCase() : ''
  const valueType = NORMALIZED_TRACK_VALUE_TYPES[valueTypeName]
  if (!valueType) {
    return null
  }

  // A custom interpolant (e.g. GLTF CUBICSPLINE) reports no standard
  // interpolation, and rebuilding it without the custom factory would silently
  // change the motion. Bail so the caller uses the in-thread parse instead.
  const interpolation = typeof track.getInterpolation === 'function'
    ? track.getInterpolation()
    : track.DefaultInterpolation
  if (typeof interpolation !== 'number' || !SUPPORTED_TRACK_INTERPOLATIONS.has(interpolation)) {
    return null
  }

  const times = track.times
  const values = track.values
  if (!ArrayBuffer.isView(times) || !ArrayBuffer.isView(values)) {
    return null
  }
  const timesBytes = toArrayBuffer(times)
  const valuesBytes = toArrayBuffer(values)
  if (timesBytes.byteLength === 0 || valuesBytes.byteLength === 0) {
    return null
  }

  return {
    name,
    valueType,
    interpolation,
    timesType: times.constructor.name,
    times: timesBytes,
    valuesType: values.constructor.name,
    values: valuesBytes,
  }
}

function serializeAnimations(animations: unknown): GltfParseAnimationDescriptor[] | null {
  if (animations == null) {
    return []
  }
  if (!Array.isArray(animations)) {
    return null
  }

  const serialized: GltfParseAnimationDescriptor[] = []
  for (const rawClip of animations) {
    const clip = rawClip as AnimationClipLike | null | undefined
    if (!clip || typeof clip !== 'object' || !Array.isArray(clip.tracks)) {
      return null
    }

    const tracks: GltfParseTrackDescriptor[] = []
    for (const rawTrack of clip.tracks) {
      const track = serializeTrack(rawTrack as KeyframeTrackLike)
      if (!track) {
        return null
      }
      tracks.push(track)
    }

    if (!tracks.length) {
      return null
    }

    const duration = typeof clip.duration === 'number' && Number.isFinite(clip.duration)
      ? clip.duration
      : -1
    serialized.push({
      name: typeof clip.name === 'string' ? clip.name : '',
      duration,
      blendMode: typeof clip.blendMode === 'number' ? clip.blendMode : 2500,
      tracks,
    })
  }

  return serialized
}

export async function serializeParsedGltfScene(
  scene: Object3DLike,
  animations: unknown = undefined,
): Promise<GltfParseDescriptor | null> {
  try {
    const root = await serializeNode(scene)
    if (!root) {
      return null
    }
    const serializedAnimations = serializeAnimations(animations === undefined ? scene.animations : animations)
    if (!serializedAnimations) {
      return null
    }
    return { root, animations: serializedAnimations }
  } catch {
    return null
  }
}

export function collectDescriptorBuffers(descriptor: GltfParseDescriptor): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = []

  const collectTexture = (texture: GltfParseTextureDescriptor | null): void => {
    if (texture && texture.bytes && texture.bytes.byteLength > 0) {
      buffers.push(texture.bytes)
    }
  }
  const collectGeometry = (geometry: GltfParseGeometryDescriptor | null): void => {
    if (!geometry) {
      return
    }
    if (geometry.index) {
      buffers.push(geometry.index.bytes)
    }
    geometry.attributes.forEach((attr) => buffers.push(attr.bytes))
    geometry.morphPosition?.forEach((attr) => buffers.push(attr.bytes))
    geometry.morphNormal?.forEach((attr) => buffers.push(attr.bytes))
  }
  const collectMaterial = (material: GltfParseMaterialDescriptor | null): void => {
    if (!material) {
      return
    }
    collectTexture(material.map)
    collectTexture(material.normalMap)
    collectTexture(material.roughnessMap)
    collectTexture(material.metalnessMap)
    collectTexture(material.emissiveMap)
    collectTexture(material.aoMap)
    collectTexture(material.alphaMap)
    collectTexture(material.bumpMap)
    collectTexture(material.displacementMap)
  }
  const collectNode = (node: GltfParseNodeDescriptor): void => {
    collectGeometry(node.geometry)
    collectMaterial(node.material)
    node.children.forEach(collectNode)
  }

  collectNode(descriptor.root)
  ;(descriptor.animations ?? []).forEach((animation) => {
    animation.tracks.forEach((track) => {
      if (track.times.byteLength > 0) {
        buffers.push(track.times)
      }
      if (track.values.byteLength > 0) {
        buffers.push(track.values)
      }
    })
  })
  return buffers
}
