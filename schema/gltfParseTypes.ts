// Shared transferable descriptor types for the worker GLB parser. Kept free of
// the 'three' import so the worker bundle does not pull the whole three runtime.

export type GltfParseTextureDescriptor = {
  bytes: ArrayBuffer
  mimeType: string | null
  wrapS: number
  wrapT: number
  flipY: boolean
  colorSpace: string
  magFilter: number
  minFilter: number
}

export type GltfParseMaterialDescriptor = {
  name: string
  type: 'MeshStandardMaterial' | 'MeshBasicMaterial' | 'MeshPhongMaterial' | 'MeshLambertMaterial'
  color: [number, number, number]
  emissive: [number, number, number]
  roughness: number
  metalness: number
  opacity: number
  transparent: boolean
  side: number
  alphaTest: number
  flatShading: boolean
  vertexColors: boolean
  wireframe: boolean
  emissiveIntensity: number
  aoMapIntensity: number
  normalScale: [number, number]
  bumpScale: number
  displacementScale: number
  specular: [number, number, number]
  shininess: number
  map: GltfParseTextureDescriptor | null
  normalMap: GltfParseTextureDescriptor | null
  roughnessMap: GltfParseTextureDescriptor | null
  metalnessMap: GltfParseTextureDescriptor | null
  emissiveMap: GltfParseTextureDescriptor | null
  aoMap: GltfParseTextureDescriptor | null
  alphaMap: GltfParseTextureDescriptor | null
  bumpMap: GltfParseTextureDescriptor | null
  displacementMap: GltfParseTextureDescriptor | null
}

export type GltfParseAttributeDescriptor = {
  name: string
  itemSize: number
  normalized: boolean
  typedArrayType: string
  bytes: ArrayBuffer
}

export type GltfParseGeometryDescriptor = {
  attributes: GltfParseAttributeDescriptor[]
  index: GltfParseAttributeDescriptor | null
  morphPosition: GltfParseAttributeDescriptor[] | null
  morphNormal: GltfParseAttributeDescriptor[] | null
}

export type GltfParseNodeDescriptor = {
  name: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
  visible: boolean
  isMesh: boolean
  geometry: GltfParseGeometryDescriptor | null
  material: GltfParseMaterialDescriptor | null
  children: GltfParseNodeDescriptor[]
}

/**
 * One animation track: the keyframe times/values travel as transferable raw
 * bytes plus the typed-array type they must be viewed as.
 *
 * `valueType` is normalized to the value type name three's own AnimationClip
 * JSON format uses ('number' | 'vector' | 'quaternion' | 'color' | 'boolean' |
 * 'string'); `interpolation` is the resolved THREE.Interpolate* constant
 * (2300 discrete / 2301 linear / 2302 smooth), the same value AnimationClip
 * JSON serialization writes.
 */
export type GltfParseTrackDescriptor = {
  name: string
  valueType: string
  interpolation: number | null
  timesType: string
  times: ArrayBuffer
  valuesType: string
  values: ArrayBuffer
}

export type GltfParseAnimationDescriptor = {
  name: string
  duration: number
  blendMode: number
  tracks: GltfParseTrackDescriptor[]
}

export type GltfParseDescriptor = {
  root: GltfParseNodeDescriptor
  /**
   * Clips parsed from the GLB. They are attached to the rebuilt root exactly
   * like the in-thread loader does, so `object.animations` consumers (the scene
   * animation runtime, external animation assets, clone helpers) keep working.
   */
  animations: GltfParseAnimationDescriptor[]
}
