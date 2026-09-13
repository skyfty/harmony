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

export type GltfParseDescriptor = {
  root: GltfParseNodeDescriptor
}
