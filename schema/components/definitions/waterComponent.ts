import type { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three'
import { Color, DataTexture, RepeatWrapping, ShaderMaterial, Vector2, Vector3 } from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const WATER_COMPONENT_TYPE = 'water'
export const WATER_DEFAULT_TEXTURE_WIDTH = 512
export const WATER_DEFAULT_TEXTURE_HEIGHT = 512
export const WATER_DEFAULT_DISTORTION_SCALE = 3.7
export const WATER_DEFAULT_SIZE = 10
export const WATER_DEFAULT_FLOW_SPEED = 1
export const WATER_MIN_TEXTURE_SIZE = 64
export const WATER_MIN_DISTORTION_SCALE = 0
export const WATER_MIN_SIZE = 1
export const WATER_MIN_FLOW_SPEED = 0

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
}

const DEFAULT_FLOW_DIRECTION: FlowDirection = { x: 0.7071, y: 0.7071 }
const DEFAULT_NORMAL_MAP = createDefaultNormalTexture()
const WATER_DEFAULT_ALPHA = 1
const WATER_DEFAULT_COLOR = 0x001e0f
const DEFAULT_WATER_COLOR = new Color(WATER_DEFAULT_COLOR)

function createDefaultNormalTexture(): Texture {
  const size = 2
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4
    data[offset] = 128
    data[offset + 1] = 128
    data[offset + 2] = 255
    data[offset + 3] = 255
  }
  const texture = new DataTexture(data, size, size)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
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
  return {
    textureWidth: width,
    textureHeight: height,
    distortionScale,
    size,
    flowDirection: normalizedFlow,
    flowSpeed,
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
  }
}

class WaterComponent extends Component<WaterComponentProps> {
  private hostMesh: Mesh | null = null
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
    const props = clampWaterComponentProps(this.context.getProps())
    this.flowOffset.x = (this.flowOffset.x + props.flowDirection.x * props.flowSpeed * 0.05 * deltaTime) % 1
    this.flowOffset.y = (this.flowOffset.y + props.flowDirection.y * props.flowSpeed * 0.05 * deltaTime) % 1
    if (this.normalTexture) {
      this.normalTexture.offset.set(this.flowOffset.x, this.flowOffset.y)
    }
    const material = this.waterInstance.material as ShaderMaterial
    material.uniforms.time.value += deltaTime * props.flowSpeed
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
      return material.length > 0 ? material[0] : null
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
    if ('color' in material && material.color) {
      return material.color.getHexString()
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
    if (material && 'color' in material && material.color) {
      return material.color.clone()
    }
    return DEFAULT_WATER_COLOR.clone()
  }

  private resolveMaterialAlpha(material: Material | null): number {
    if (!material) {
      return WATER_DEFAULT_ALPHA
    }
    const opacity = typeof material.opacity === 'number' ? Math.max(0, Math.min(1, material.opacity)) : WATER_DEFAULT_ALPHA
    return opacity
  }

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
    const baseGeometry = mesh.geometry ? mesh.geometry.clone() : null
    if (baseGeometry) {
      this.waterGeometry = baseGeometry
    }
    const normalTexture = this.prepareNormalTexture(this.resolveMaterialNormalMap(material))
    this.normalTexture = normalTexture
    const water = new Water(baseGeometry ?? undefined, {
      textureWidth: props.textureWidth,
      textureHeight: props.textureHeight,
      alpha: this.resolveMaterialAlpha(material),
      waterColor: this.resolveMaterialColor(material),
      distortionScale: props.distortionScale,
      waterNormals: normalTexture,
    })
    water.name = `${mesh.name ?? 'Water'} (Water)`
    water.renderOrder = mesh.renderOrder
    const shaderMaterial = water.material as ShaderMaterial
    shaderMaterial.uniforms.normalSampler.value = normalTexture
    shaderMaterial.uniforms.size.value = props.size
    mesh.add(water)
    mesh.visible = false
    this.waterInstance = water
    this.applyUniforms(props, material)
    this.syncSunUniforms()
  }

  private prepareNormalTexture(source: Texture | null): Texture {
    const base = source ?? DEFAULT_NORMAL_MAP
    const clone = base.clone()
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
    shaderMaterial.uniforms.alpha.value = this.resolveMaterialAlpha(material)
    shaderMaterial.uniforms.distortionScale.value = props.distortionScale
    shaderMaterial.uniforms.size.value = props.size
    shaderMaterial.uniforms.waterColor.value.copy(this.resolveMaterialColor(material))
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
      material.uniforms.sunDirection.value.copy(direction)
      material.uniforms.sunColor.value.copy(light.color)
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
    if (this.waterInstance && this.hostMesh) {
      this.hostMesh.remove(this.waterInstance)
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
  canAttach(node: SceneNode) {
    const type = typeof node.nodeType === 'string' ? node.nodeType.trim().toLowerCase() : ''
    return type === 'mesh' || Boolean(node.dynamicMesh) || Boolean(node.sourceAssetId)
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
