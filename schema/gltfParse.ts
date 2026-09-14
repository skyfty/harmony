import * as THREE from 'three'
import type {
  GltfParseAnimationDescriptor,
  GltfParseAttributeDescriptor,
  GltfParseDescriptor,
  GltfParseGeometryDescriptor,
  GltfParseMaterialDescriptor,
  GltfParseNodeDescriptor,
  GltfParseTextureDescriptor,
  GltfParseTrackDescriptor,
} from './gltfParseTypes'

export type {
  GltfParseAttributeDescriptor,
  GltfParseDescriptor,
  GltfParseGeometryDescriptor,
  GltfParseMaterialDescriptor,
  GltfParseNodeDescriptor,
  GltfParseTextureDescriptor,
} from './gltfParseTypes'

// ---------------------------------------------------------------------------
// Main-thread rebuild: reconstruct the THREE scene from the transferable
// descriptor produced by the worker.
// ---------------------------------------------------------------------------

function rebuildAttribute(attr: GltfParseAttributeDescriptor): THREE.BufferAttribute {
  const array = rebuildTypedArray(attr.typedArrayType, attr.bytes)
  return new THREE.BufferAttribute(array as THREE.TypedArray, attr.itemSize, attr.normalized)
}

function rebuildTypedArray(typedArrayType: string, bytes: ArrayBuffer): ArrayBufferView {
  const Ctor = (globalThis as unknown as Record<string, unknown>)[typedArrayType] as
    | (new (buffer: ArrayBuffer) => ArrayBufferView)
    | undefined
  if (typeof Ctor !== 'function') {
    throw new Error(`Unsupported typed array type ${typedArrayType}`)
  }
  return new Ctor(bytes)
}

type TrackConstructor = new (
  name: string,
  times: THREE.TypedArray,
  values: THREE.TypedArray,
  interpolation?: number,
) => THREE.KeyframeTrack

/** Track value type -> concrete KeyframeTrack, mirroring AnimationClip JSON. */
const TRACK_TYPE_BY_VALUE_TYPE: Record<string, TrackConstructor> = {
  number: THREE.NumberKeyframeTrack as unknown as TrackConstructor,
  vector: THREE.VectorKeyframeTrack as unknown as TrackConstructor,
  quaternion: THREE.QuaternionKeyframeTrack as unknown as TrackConstructor,
  color: THREE.ColorKeyframeTrack as unknown as TrackConstructor,
  boolean: THREE.BooleanKeyframeTrack as unknown as TrackConstructor,
  string: THREE.StringKeyframeTrack as unknown as TrackConstructor,
}

function rebuildTrack(descriptor: GltfParseTrackDescriptor): THREE.KeyframeTrack {
  const Ctor = TRACK_TYPE_BY_VALUE_TYPE[descriptor.valueType] as TrackConstructor | undefined
  if (!Ctor) {
    // Throwing makes parseGltfWithWorker() resolve null, which sends the caller
    // back to the fully faithful in-thread GLB parse.
    throw new Error(`Unsupported keyframe track value type ${descriptor.valueType}`)
  }
  const times = rebuildTypedArray(descriptor.timesType, descriptor.times) as THREE.TypedArray
  const values = rebuildTypedArray(descriptor.valuesType, descriptor.values) as THREE.TypedArray
  return new Ctor(descriptor.name, times, values, descriptor.interpolation ?? undefined)
}

function rebuildAnimationClip(descriptor: GltfParseAnimationDescriptor): THREE.AnimationClip {
  const tracks = (descriptor.tracks ?? []).map(rebuildTrack)
  return new THREE.AnimationClip(
    descriptor.name,
    descriptor.duration,
    tracks,
    descriptor.blendMode as THREE.AnimationBlendMode,
  )
}

function rebuildGeometry(geometry: GltfParseGeometryDescriptor): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  geometry.attributes.forEach((attr) => {
    result.setAttribute(attr.name, rebuildAttribute(attr))
  })
  if (geometry.index) {
    result.setIndex(rebuildAttribute(geometry.index))
  }
  if (geometry.morphPosition && geometry.morphPosition.length) {
    result.morphAttributes.position = geometry.morphPosition.map((attr) => rebuildAttribute(attr))
  }
  if (geometry.morphNormal && geometry.morphNormal.length) {
    result.morphAttributes.normal = geometry.morphNormal.map((attr) => rebuildAttribute(attr))
  }
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

async function rebuildTexture(descriptor: GltfParseTextureDescriptor): Promise<THREE.Texture> {
  const texture = new THREE.Texture()
  texture.wrapS = descriptor.wrapS as THREE.Wrapping
  texture.wrapT = descriptor.wrapT as THREE.Wrapping
  texture.flipY = descriptor.flipY
  texture.colorSpace = descriptor.colorSpace as THREE.ColorSpace
  texture.magFilter = descriptor.magFilter as THREE.MagnificationTextureFilter
  texture.minFilter = descriptor.minFilter as THREE.MinificationTextureFilter

  if (typeof createImageBitmap === 'function') {
    try {
      const blob = new Blob([descriptor.bytes], { type: descriptor.mimeType ?? 'image/png' })
      texture.image = await createImageBitmap(blob)
      texture.needsUpdate = true
      return texture
    } catch {
      /* fall through to DataTexture */
    }
  }

  texture.image = { data: descriptor.bytes, width: 1, height: 1 }
  texture.needsUpdate = true
  return texture
}

type RebuildMaterialLike = THREE.Material & {
  color: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
  roughness?: number
  metalness?: number
  flatShading: boolean
  wireframe: boolean
  aoMapIntensity?: number
  normalScale?: THREE.Vector2
  bumpScale?: number
  displacementScale?: number
  specular?: THREE.Color
  shininess?: number
  map?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  metalnessMap?: THREE.Texture | null
  emissiveMap?: THREE.Texture | null
  aoMap?: THREE.Texture | null
  alphaMap?: THREE.Texture | null
  bumpMap?: THREE.Texture | null
  displacementMap?: THREE.Texture | null
}

async function rebuildMaterial(descriptor: GltfParseMaterialDescriptor): Promise<THREE.Material> {
  let material: THREE.Material
  switch (descriptor.type) {
    case 'MeshBasicMaterial':
      material = new THREE.MeshBasicMaterial()
      break
    case 'MeshPhongMaterial':
      material = new THREE.MeshPhongMaterial()
      break
    case 'MeshLambertMaterial':
      material = new THREE.MeshLambertMaterial()
      break
    default:
      material = new THREE.MeshStandardMaterial()
  }

  const target = material as RebuildMaterialLike
  target.name = descriptor.name
  target.color.setRGB(descriptor.color[0], descriptor.color[1], descriptor.color[2])
  target.opacity = descriptor.opacity
  target.transparent = descriptor.transparent
  target.side = descriptor.side as THREE.Side
  target.alphaTest = descriptor.alphaTest
  target.flatShading = descriptor.flatShading
  target.vertexColors = descriptor.vertexColors
  target.wireframe = descriptor.wireframe
  target.emissive?.setRGB(descriptor.emissive[0], descriptor.emissive[1], descriptor.emissive[2])
  if (typeof target.emissiveIntensity === 'number') {
    target.emissiveIntensity = descriptor.emissiveIntensity
  }
  if (typeof target.roughness === 'number') {
    target.roughness = descriptor.roughness
  }
  if (typeof target.metalness === 'number') {
    target.metalness = descriptor.metalness
  }
  if (typeof target.aoMapIntensity === 'number') {
    target.aoMapIntensity = descriptor.aoMapIntensity
  }
  if (target.normalScale) {
    target.normalScale.set(descriptor.normalScale[0], descriptor.normalScale[1])
  }
  if (typeof target.bumpScale === 'number') {
    target.bumpScale = descriptor.bumpScale
  }
  if (typeof target.displacementScale === 'number') {
    target.displacementScale = descriptor.displacementScale
  }
  if (target.specular) {
    target.specular.setRGB(descriptor.specular[0], descriptor.specular[1], descriptor.specular[2])
  }
  if (typeof target.shininess === 'number') {
    target.shininess = descriptor.shininess
  }

  type RebuildTextureSlotKey = 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap' | 'aoMap' | 'alphaMap' | 'bumpMap' | 'displacementMap'
  const slotMap: Array<[keyof GltfParseMaterialDescriptor, RebuildTextureSlotKey]> = [
    ['map', 'map'],
    ['normalMap', 'normalMap'],
    ['roughnessMap', 'roughnessMap'],
    ['metalnessMap', 'metalnessMap'],
    ['emissiveMap', 'emissiveMap'],
    ['aoMap', 'aoMap'],
    ['alphaMap', 'alphaMap'],
    ['bumpMap', 'bumpMap'],
    ['displacementMap', 'displacementMap'],
  ]
  for (const [key, targetKey] of slotMap) {
    const textureDescriptor = descriptor[key] as GltfParseTextureDescriptor | null
    if (!textureDescriptor) {
      continue
    }
    target[targetKey] = await rebuildTexture(textureDescriptor)
  }
  material.needsUpdate = true
  return material
}

async function rebuildNode(descriptor: GltfParseNodeDescriptor): Promise<THREE.Object3D> {
  let object: THREE.Object3D
  if (descriptor.isMesh && descriptor.geometry) {
    const mesh = new THREE.Mesh(rebuildGeometry(descriptor.geometry))
    if (descriptor.material) {
      mesh.material = await rebuildMaterial(descriptor.material)
    }
    object = mesh
  } else {
    object = new THREE.Object3D()
  }

  object.name = descriptor.name
  object.position.set(descriptor.position[0], descriptor.position[1], descriptor.position[2])
  object.quaternion.set(descriptor.quaternion[0], descriptor.quaternion[1], descriptor.quaternion[2], descriptor.quaternion[3])
  object.scale.set(descriptor.scale[0], descriptor.scale[1], descriptor.scale[2])
  object.visible = descriptor.visible

  for (const child of descriptor.children) {
    object.add(await rebuildNode(child))
  }
  return object
}

export async function rebuildGltfScene(descriptor: GltfParseDescriptor): Promise<THREE.Object3D> {
  const root = await rebuildNode(descriptor.root)
  // Mirror the in-thread GLTF path (schema/loader.ts): clips live on the root
  // object so collectAnimationClips() / cloneImportedObject() can find them.
  const animations = (descriptor.animations ?? []).map(rebuildAnimationClip)
  if (animations.length) {
    ;(root as unknown as { animations?: THREE.AnimationClip[] }).animations = animations
    root.userData = root.userData ?? {}
    root.userData.__animations = animations.map((clip) => clip.name)
  }
  root.updateMatrixWorld(true)
  return root
}

// ---------------------------------------------------------------------------
// Worker host (one-shot worker per parse)
// ---------------------------------------------------------------------------

export type GltfParseWorkerFactory = () => Worker | null

const gltfParseWorkerRuntimeState: { factory: GltfParseWorkerFactory | null } = { factory: null }

// Set once when the configured factory turned out to be unable to hand back a
// worker at call time (unsupported platform, missing bundle, CSP, ...). Callers
// must consult canParseGltfWithWorker() *before* reading an asset into memory:
// reading a whole GLB only to discover there is no worker costs a full redundant
// main-thread file read per model.
let gltfParseWorkerRuntimeUnavailable = false

export function configureGltfParseWorkerFactory(factory: GltfParseWorkerFactory | null): void {
  gltfParseWorkerRuntimeState.factory = factory
  gltfParseWorkerRuntimeUnavailable = false
}

export function isGltfParseWorkerConfigured(): boolean {
  return gltfParseWorkerRuntimeState.factory !== null
}

/**
 * Cheap, side-effect-free gate for "should this call site pay to materialise the
 * GLB bytes for a worker parse?". Returns false as soon as a factory is absent or
 * known to be unusable, so the caller can skip the read entirely.
 */
export function canParseGltfWithWorker(): boolean {
  return gltfParseWorkerRuntimeState.factory !== null && !gltfParseWorkerRuntimeUnavailable
}

/** Record that the configured factory cannot actually produce a worker. */
export function markGltfParseWorkerUnavailable(): void {
  gltfParseWorkerRuntimeUnavailable = true
}

let gltfParseRequestId = 1

type GltfParseWorkerMessage =
  | { type: 'result'; requestId: number; descriptor: GltfParseDescriptor }
  | { type: 'unsupported'; requestId: number; reason: string }
  | { type: 'error'; requestId: number; message: string }

export async function parseGltfWithWorker(buffer: ArrayBuffer): Promise<THREE.Object3D | null> {
  const factory = gltfParseWorkerRuntimeState.factory
  // Honour the latch as well as the factory: once a configured factory has failed
  // to deliver, every further call would just burn another failed worker attempt.
  if (!factory || gltfParseWorkerRuntimeUnavailable || buffer.byteLength <= 0) {
    return null
  }
  const worker = factory()
  if (!worker) {
    // Remember this: the factory is configured but cannot deliver, so later
    // callers can skip materialising the GLB bytes for a doomed worker attempt.
    gltfParseWorkerRuntimeUnavailable = true
    return null
  }

  return new Promise<THREE.Object3D | null>((resolve) => {
    const requestId = gltfParseRequestId
    gltfParseRequestId += 1
    let settled = false

    const cleanup = (): void => {
      clearTimeout(timeoutHandle)
      try {
        worker.removeEventListener?.('message', onMessage)
      } catch {
        /* noop */
      }
      try {
        worker.terminate?.()
      } catch {
        /* noop */
      }
    }
    const onMessage = (event: MessageEvent<GltfParseWorkerMessage>): void => {
      const message = event?.data
      if (!message || typeof message !== 'object' || message.requestId !== requestId) {
        return
      }
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (message.type === 'result') {
        rebuildGltfScene(message.descriptor)
          .then(resolve)
          .catch(() => {
            resolve(null)
          })
        return
      }
      resolve(null)
    }
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(null)
    }, 30_000)

    try {
      worker.addEventListener('message', onMessage)
    } catch {
      settled = true
      cleanup()
      resolve(null)
      return
    }

    try {
      worker.postMessage({ type: 'parse', requestId, buffer })
    } catch {
      settled = true
      cleanup()
      resolve(null)
    }
  })
}
