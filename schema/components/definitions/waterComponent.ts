import type { Material, Mesh, Object3D, Texture } from 'three'
import {
  BufferGeometry,
  Color,
  DataTexture,
  
  RepeatWrapping,
  NoColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { Component, type ComponentRuntimeContext } from '../Component'
import {
  componentManager,
  type ComponentDefinition,
  COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
} from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { isGeometryType } from '@harmony/schema'

export const WATER_COMPONENT_TYPE = 'water'
export const WATER_DEFAULT_TEXTURE_WIDTH = 512
export const WATER_DEFAULT_TEXTURE_HEIGHT = 512
export const WATER_DEFAULT_DISTORTION_SCALE = 3.7
export const WATER_DEFAULT_SIZE = 10
export const WATER_DEFAULT_FLOW_SPEED = 1
export const WATER_DEFAULT_WAVE_STRENGTH = 1
export const WATER_MIN_TEXTURE_SIZE = 64
export const WATER_MIN_DISTORTION_SCALE = 0
export const WATER_MIN_SIZE = 1
export const WATER_MIN_FLOW_SPEED = 0
export const WATER_MIN_WAVE_STRENGTH = 0

export interface FlowDirection {
  x: number
  y: number
}

export interface WaterComponentProps {
  textureWidth: number
  textureHeight: number
  distortionScale: number
  size: number
  flowDirection: FlowDirection
  flowSpeed: number
  waveStrength: number
}

const DEFAULT_FLOW_DIRECTION: FlowDirection = { x: 0.7071, y: 0.7071 }
const DEFAULT_NORMAL_MAP = createDefaultNormalTexture()
const WATER_DEFAULT_ALPHA = 1
const WATER_DEFAULT_COLOR = 0x001e0f
const DEFAULT_WATER_COLOR = new Color(WATER_DEFAULT_COLOR)

// Removed unused PositionAttribute type

// Removed unused computePositionBounds helper

// Removed unused planar UV / flat normal helpers: ensurePlanarUVs, ensureFlatNormals

function createDefaultNormalTexture(): Texture {
  // Use a small procedural, tileable normal map so the water surface doesn't look flat
  // when no normalMap is provided by the host mesh material.
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const amp = 2.0
  const freq = (Math.PI * 2 * 4) / size

  const sampleHeight = (x: number, y: number): number => {
    const nx = (x + size) % size
    const ny = (y + size) % size
    return Math.sin(nx * freq) + Math.cos(ny * freq)
  }

  const normal = new Vector3()
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const hL = sampleHeight(x - 1, y)
      const hR = sampleHeight(x + 1, y)
      const hD = sampleHeight(x, y - 1)
      const hU = sampleHeight(x, y + 1)

      const dhdx = (hR - hL) * 0.5
      const dhdz = (hU - hD) * 0.5

      normal.set(-dhdx * amp, 1, -dhdz * amp).normalize()

      const offset = (y * size + x) * 4
      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255)
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255)
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255)
      data[offset + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // Normal maps are non-color data.
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

function normalizeFlowDirection(candidate?: FlowDirection | null): FlowDirection {
  const rawX = typeof candidate?.x === 'number' ? candidate.x : 1
  const rawY = typeof candidate?.y === 'number' ? candidate.y : 1
  const length = Math.hypot(rawX, rawY)
  if (length < 1e-4) {
    return { ...DEFAULT_FLOW_DIRECTION }
  }
  return { x: rawX / length, y: rawY / length }
}

export function clampWaterComponentProps(
  props: Partial<WaterComponentProps> | null | undefined,
): WaterComponentProps {
  const normalizedFlow = normalizeFlowDirection(props?.flowDirection ?? null)
  const width = Number.isFinite(props?.textureWidth)
    ? Math.max(WATER_MIN_TEXTURE_SIZE, props!.textureWidth!)
    : WATER_DEFAULT_TEXTURE_WIDTH
  const height = Number.isFinite(props?.textureHeight)
    ? Math.max(WATER_MIN_TEXTURE_SIZE, props!.textureHeight!)
    : WATER_DEFAULT_TEXTURE_HEIGHT
  const distortionScale = Number.isFinite(props?.distortionScale)
    ? Math.max(WATER_MIN_DISTORTION_SCALE, props!.distortionScale!)
    : WATER_DEFAULT_DISTORTION_SCALE
  const size = Number.isFinite(props?.size) ? Math.max(WATER_MIN_SIZE, props!.size!) : WATER_DEFAULT_SIZE
  const flowSpeed = Number.isFinite(props?.flowSpeed)
    ? Math.max(WATER_MIN_FLOW_SPEED, props!.flowSpeed!)
    : WATER_DEFAULT_FLOW_SPEED
  const waveStrength = Number.isFinite(props?.waveStrength)
    ? Math.max(WATER_MIN_WAVE_STRENGTH, props!.waveStrength!)
    : WATER_DEFAULT_WAVE_STRENGTH
  return {
    textureWidth: width,
    textureHeight: height,
    distortionScale,
    size,
    flowDirection: normalizedFlow,
    flowSpeed,
    waveStrength,
  }
}

export function cloneWaterComponentProps(props: WaterComponentProps): WaterComponentProps {
  return {
    textureWidth: props.textureWidth,
    textureHeight: props.textureHeight,
    distortionScale: props.distortionScale,
    size: props.size,
    flowDirection: { x: props.flowDirection.x, y: props.flowDirection.y },
    flowSpeed: props.flowSpeed,
    waveStrength: props.waveStrength,
  }
}

class WaterComponent extends Component<WaterComponentProps> {
  private hostMesh: Mesh | null = null
  private waterParent: Object3D | null = null
  private waterInstance: Water | null = null
  private waterGeometry: BufferGeometry | null = null
  private normalTexture: Texture | null = null
  private flowOffset = new Vector2()
  private resolvedFlowDirection = new Vector2(1, 1)
  private lastSignature: string | null = null

  constructor(context: ComponentRuntimeContext<WaterComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.updateRuntimeObject(object)
  }

  onPropsUpdated(): void {
    this.updateRuntimeObject(this.context.getRuntimeObject())
  }

  onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.destroyWater()
      if (this.hostMesh) {
        this.hostMesh.visible = true
      }
      return
    }
    this.updateRuntimeObject(this.context.getRuntimeObject())
  }

  onUpdate(deltaTime: number): void {
    if (!this.waterInstance) {
      return
    }
    this.syncWaterTransform()
    const props = clampWaterComponentProps(this.context.getProps())
    const material = this.waterInstance.material as ShaderMaterial
    if (material.uniforms?.time) {
      material.uniforms.time.value += deltaTime * props.flowSpeed
    }
    this.syncSunUniforms()
  }

  private updateRuntimeObject(object: Object3D | null): void {
    if (!this.context.isEnabled()) {
      this.destroyWater()
      return
    }
    const mesh = this.resolveHostMesh(object)
    if (!mesh) {
      this.destroyWater()
      return
    }
    const props = clampWaterComponentProps(this.context.getProps())
    const material = this.selectPrimaryMaterial(mesh.material)
    const materialSignature = this.computeMaterialSignature(material)
    const signature = this.createRebuildSignature(props, materialSignature)
    if (this.hostMesh !== mesh || signature !== this.lastSignature) {
      this.destroyWater()
      this.hostMesh = mesh
      this.lastSignature = signature
      this.createWater(mesh, props, material)
      return
    }
    this.applyUniforms(props, material)
  }

  private resolveHostMesh(root: Object3D | null): Mesh | null {
    if (!root) {
      return null
    }
    if ((root as Mesh).isMesh) {
      return root as Mesh
    }
    for (const child of root.children) {
      const result = this.resolveHostMesh(child)
      if (result) {
        return result
      }
    }
    return null
  }

  private selectPrimaryMaterial(material: Material | Material[] | null | undefined): Material | null {
    if (!material) {
      return null
    }
    if (Array.isArray(material)) {
      return material.length > 0 ? material[0] ?? null : null
    }
    return material
  }

  private computeMaterialSignature(material: Material | null): string {
    if (!material) {
      return 'material:none'
    }
    const colorHex = this.getMaterialColorHex(material)
    const opacity = typeof material.opacity === 'number' ? material.opacity.toFixed(4) : WATER_DEFAULT_ALPHA.toFixed(4)
    const transparentFlag = material.transparent ? 't' : 'f'
    const normalKey = this.getNormalTextureKey(material)
    return [colorHex, opacity, transparentFlag, normalKey].join('|')
  }

  private getMaterialColorHex(material: Material): string {
    const colored = material as Material & { color?: Color }
    if (colored.color && typeof colored.color.getHexString === 'function') {
      return colored.color.getHexString()
    }
    return DEFAULT_WATER_COLOR.getHexString()
  }

  private getNormalTextureKey(material: Material): string {
    if (!('normalMap' in material)) {
      return 'normal:none'
    }
    const normalMap = (material as { normalMap?: Texture | null }).normalMap
    if (!normalMap) {
      return 'normal:none'
    }
    const source = (normalMap as Texture & { image?: { src?: string } }).image?.src ?? ''
    return `${normalMap.uuid}:${source}`
  }

  private resolveMaterialColor(material: Material | null): Color {
    const colored = material as (Material & { color?: Color }) | null
    if (colored?.color && typeof colored.color.clone === 'function') {
      return colored.color.clone()
    }
    return DEFAULT_WATER_COLOR.clone()
  }

  // Removed unused resolveMaterialAlpha

  private resolveMaterialNormalMap(material: Material | null): Texture | null {
    if (!material) {
      return null
    }
    if ('normalMap' in material) {
      return (material as { normalMap?: Texture | null }).normalMap ?? null
    }
    return null
  }

  private createRebuildSignature(props: WaterComponentProps, materialSignature: string): string {
    return [props.textureWidth, props.textureHeight, materialSignature].join('_')
  }

  private createWater(mesh: Mesh, props: WaterComponentProps, material: Material | null): void {
    const baseGeometry = mesh.geometry?.clone?.() as BufferGeometry | undefined
    const resolvedGeometry = baseGeometry ?? new BufferGeometry()
    this.waterGeometry = resolvedGeometry
    const normalTexture = this.prepareNormalTexture(this.resolveMaterialNormalMap(material))
    this.normalTexture = normalTexture

    const water = new Water(resolvedGeometry, {
      textureWidth: props.textureWidth,
      textureHeight: props.textureHeight,
      waterColor: this.resolveMaterialColor(material).getHex(),
      distortionScale: Math.max(WATER_MIN_DISTORTION_SCALE, props.distortionScale * props.waveStrength),
      waterNormals: normalTexture,
    })
    water.name = `${mesh.name ?? 'Water'} (Water)`
    water.userData = water.userData ?? {}
    water.userData[COMPONENT_ARTIFACT_KEY] = true
    water.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = this.context.nodeId
    water.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = this.context.componentId
    water.renderOrder = mesh.renderOrder

    const parent = mesh.parent
    if (parent) {
      water.position.copy(mesh.position)
      water.quaternion.copy(mesh.quaternion)
      water.scale.copy(mesh.scale)
      
      parent.add(water)
      this.waterParent = parent
      // Hide the original floor plane mesh to avoid z-fighting.
      mesh.visible = false
    } else {
      // Fallback: keep behavior safe if the mesh is not attached yet.
      mesh.add(water)
      this.waterParent = mesh
      // Don't hide the host mesh here; a hidden parent would also hide the Water child.
    }
    this.waterInstance = water
    this.applyUniforms(props, material)
    this.syncSunUniforms()
  }

  private syncWaterTransform(): void {
    if (!this.waterInstance || !this.hostMesh) {
      return
    }
    // Keep Water aligned with the host mesh even though it's not parented under it.
    this.waterInstance.position.copy(this.hostMesh.position)
    this.waterInstance.quaternion.copy(this.hostMesh.quaternion)
    this.waterInstance.scale.copy(this.hostMesh.scale)
    this.waterInstance.updateMatrix()
    this.waterInstance.updateMatrixWorld(true)
  }

  private prepareNormalTexture(source: Texture | null): Texture {
    const base = source ?? DEFAULT_NORMAL_MAP
    const clone = base.clone()
    // Mirrored repeat hides many visible tile seams better than repeat.
    clone.wrapS = RepeatWrapping
    clone.wrapT = RepeatWrapping
    clone.needsUpdate = true
    return clone
  }

  private applyUniforms(props: WaterComponentProps, material: Material | null): void {
    if (!this.waterInstance) {
      return
    }
    const shaderMaterial = this.waterInstance.material as ShaderMaterial
    if (shaderMaterial.uniforms?.distortionScale) {
      shaderMaterial.uniforms.distortionScale.value = Math.max(WATER_MIN_DISTORTION_SCALE, props.distortionScale * props.waveStrength)
    }
    if (shaderMaterial.uniforms?.size) {
      shaderMaterial.uniforms.size.value = props.size
    }
    if (shaderMaterial.uniforms?.waterColor) {
      shaderMaterial.uniforms.waterColor.value.copy(this.resolveMaterialColor(material))
    }
    this.resolvedFlowDirection.set(props.flowDirection.x, props.flowDirection.y)
    const normalized = this.resolvedFlowDirection.lengthSq() > 1e-6
      ? this.resolvedFlowDirection.normalize()
      : new Vector2(DEFAULT_FLOW_DIRECTION.x, DEFAULT_FLOW_DIRECTION.y)
    this.resolvedFlowDirection.copy(normalized)
    this.flowOffset.set(0, 0)
    this.syncSunUniforms()
  }

  private syncSunUniforms(): void {
    if (!this.waterInstance) {
      return
    }
    const root = this.resolveSceneRoot(this.hostMesh ?? this.context.getRuntimeObject())
    const light = this.findSunLight(root)
    const material = this.waterInstance.material as ShaderMaterial
    if (light) {
      const direction = new Vector3()
      const targetPosition = new Vector3()
      light.target?.getWorldPosition(targetPosition)
      light.getWorldPosition(direction)
      direction.sub(targetPosition).normalize()
      if (material.uniforms?.sunDirection) {
        material.uniforms.sunDirection.value.copy(direction)
      }
      if (material.uniforms?.sunColor) {
        material.uniforms.sunColor.value.copy(light.color)
      }
    }
  }

  private resolveSceneRoot(object: Object3D | null): Object3D | null {
    if (!object) {
      return null
    }
    let ancestor: Object3D | null = object
    while (ancestor?.parent) {
      ancestor = ancestor.parent
    }
    return ancestor ?? object
  }

  private findSunLight(object: Object3D | null): import('three').DirectionalLight | null {
    if (!object) {
      return null
    }
    if ('isDirectionalLight' in object && object.isDirectionalLight) {
      return object as import('three').DirectionalLight
    }
    for (const child of object.children) {
      const result = this.findSunLight(child)
      if (result) {
        return result
      }
    }
    return null
  }

  private destroyWater(): void {
    if (this.waterInstance) {
      this.waterParent?.remove(this.waterInstance)
      this.waterParent = null
      this.meshVisibility(true)
      if (this.waterInstance.geometry) {
        this.waterInstance.geometry.dispose()
      }
      if (this.waterInstance.material) {
        this.waterInstance.material.dispose()
      }
      this.waterInstance = null
    }
    if (this.waterGeometry) {
      this.waterGeometry.dispose()
      this.waterGeometry = null
    }
    if (this.normalTexture) {
      this.normalTexture.dispose()
      this.normalTexture = null
    }
    this.hostMesh = null
    this.lastSignature = null
  }

  private meshVisibility(value: boolean): void {
    if (this.hostMesh) {
      this.hostMesh.visible = value
    }
  }
}

const waterComponentDefinition: ComponentDefinition<WaterComponentProps> = {
  type: WATER_COMPONENT_TYPE,
  label: 'Water',
  icon: 'mdi-water',
  order: 65,
  inspector: [],
  recreateOnPropsChange: true,
  canAttach(node: SceneNode) {
    const type = typeof node.nodeType === 'string' ? node.nodeType.trim() : ''
    return type === 'Mesh' || isGeometryType(type) || Boolean(node.dynamicMesh) || Boolean(node.sourceAssetId)
  },
  createDefaultProps(_node: SceneNode) {
    return clampWaterComponentProps(null)
  },
  createInstance(context) {
    return new WaterComponent(context)
  },
}

componentManager.registerDefinition(waterComponentDefinition)

export function createWaterComponentState(
  node: SceneNode,
  overrides?: Partial<WaterComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<WaterComponentProps> {
  const defaults = waterComponentDefinition.createDefaultProps(node)
  const merged = clampWaterComponentProps({ ...defaults, ...overrides })
  return {
    id: options.id ?? '',
    type: WATER_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { waterComponentDefinition }

export type WaterPresetId = 'lake' | 'ocean' | 'river' | 'pool' | 'deepSea'

export interface WaterPresetDefinition {
  id: WaterPresetId
  label: string
  alpha: number
  waveStrength: number
  waterColor: number
  distortionScale: number
  size: number
  flowSpeed: number
}

export const WATER_PRESETS: WaterPresetDefinition[] = [
  {
    id: 'lake',
    label: 'Lake',
    alpha: 0.75,
    waveStrength: 0.5,
    waterColor: 0x006994,
    distortionScale: 3.0,
    size: 10.0,
    flowSpeed: 1.0,
  },
  {
    id: 'ocean',
    label: 'Ocean',
    alpha: 0.5,
    waveStrength: 1.0,
    waterColor: 0x003366,
    distortionScale: 5.0,
    size: 15.0,
    flowSpeed: 1.5,
  },
  {
    id: 'river',
    label: 'River',
    alpha: 0.8,
    waveStrength: 0.3,
    waterColor: 0x339966,
    distortionScale: 2.0,
    size: 8.0,
    flowSpeed: 1.2,
  },
  {
    id: 'pool',
    label: 'Pool',
    alpha: 0.9,
    waveStrength: 0.1,
    waterColor: 0x99ccff,
    distortionScale: 1.0,
    size: 5.0,
    flowSpeed: 0.5,
  },
  {
    id: 'deepSea',
    label: 'Deep Sea',
    alpha: 0.4,
    waveStrength: 1.2,
    waterColor: 0x001f3f,
    distortionScale: 6.0,
    size: 20.0,
    flowSpeed: 1.8,
  },
]
