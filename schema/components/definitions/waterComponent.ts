import type { Material, Mesh, Object3D, Texture } from 'three'
import {
  BufferGeometry,
  Color,
  CubeCamera,
  DataTexture,
  LinearFilter,
  Mesh as ThreeMesh,
  MeshStandardMaterial,
  
  RepeatWrapping,
  NoColorSpace,
  ShaderMaterial,
  WebGLCubeRenderTarget,
  type Scene,
  type WebGLRenderer,
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
import { isGeometryType } from '../../index'

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

export type WaterImplementationMode = 'auto' | 'static' | 'dynamic'

export const WATER_DEFAULT_IMPLEMENTATION_MODE: WaterImplementationMode = 'auto'

const WATER_STATIC_ENVMAP_SIZE = 64

export interface FlowDirection {
  x: number
  y: number
}

export interface WaterComponentProps {
  implementationMode: WaterImplementationMode
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

function normalizeImplementationMode(candidate: unknown): WaterImplementationMode {
  if (candidate === 'auto' || candidate === 'static' || candidate === 'dynamic') {
    return candidate
  }
  return WATER_DEFAULT_IMPLEMENTATION_MODE
}

function isWeChatMiniProgramRuntime(): boolean {
  const wx = (globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx
  return Boolean(wx && typeof wx.getSystemInfoSync === 'function')
}

function isMobileUserAgentRuntime(): boolean {
  const nav = (globalThis as typeof globalThis & { navigator?: { userAgent?: string } }).navigator
  const ua = typeof nav?.userAgent === 'string' ? nav.userAgent : ''
  if (!ua) {
    return false
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
}

function resolveEffectiveImplementationMode(mode: WaterImplementationMode): Exclude<WaterImplementationMode, 'auto'> {
  if (mode !== 'auto') {
    return mode
  }
  const isMobile = isWeChatMiniProgramRuntime() || isMobileUserAgentRuntime()
  return isMobile ? 'static' : 'dynamic'
}

export function clampWaterComponentProps(
  props: Partial<WaterComponentProps> | null | undefined,
): WaterComponentProps {
  const implementationMode = normalizeImplementationMode((props as any)?.implementationMode)
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
    implementationMode,
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
    implementationMode: props.implementationMode,
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
  private staticWaterMesh: Mesh | null = null
  private staticWaterMaterial: MeshStandardMaterial | null = null
  private staticEnvTarget: WebGLCubeRenderTarget | null = null
  private staticEnvCamera: CubeCamera | null = null
  private staticEnvHasCaptured = false
  private staticEnvNeedsCapture = false
  private staticEnvIsCapturing = false
  private staticEnvLastCapturedWorldPos: Vector3 | null = null
  private waterGeometry: BufferGeometry | null = null
  private normalTexture: Texture | null = null
  private flowOffset = new Vector2()
  private resolvedFlowDirection = new Vector2(1, 1)
  private lastSignature: string | null = null

  private staticNormalScrollSpeed = 0.03

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
    const props = clampWaterComponentProps(this.context.getProps())
    const effectiveMode = resolveEffectiveImplementationMode(props.implementationMode)

    if (effectiveMode === 'dynamic' && this.waterInstance) {
      this.syncWaterTransform(this.waterInstance)
      const material = this.waterInstance.material as ShaderMaterial
      if (material.uniforms?.time) {
        material.uniforms.time.value += deltaTime * props.flowSpeed
      }
      this.syncSunUniforms()
      return
    }

    if (effectiveMode === 'static' && this.staticWaterMesh) {
      this.syncWaterTransform(this.staticWaterMesh)
      this.tickStaticNormalScroll(deltaTime, props)
      this.markStaticEnvCaptureIfMoved()
      this.syncSunUniforms()
    }
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
    const effectiveMode = resolveEffectiveImplementationMode(props.implementationMode)
    const material = this.selectPrimaryMaterial(mesh.material)
    const materialSignature = this.computeMaterialSignature(material)
    const signature = this.createRebuildSignature(props, materialSignature, effectiveMode)
    if (this.hostMesh !== mesh || signature !== this.lastSignature) {
      this.destroyWater()
      this.hostMesh = mesh
      this.lastSignature = signature
      if (effectiveMode === 'dynamic') {
        this.createDynamicWater(mesh, props, material)
      } else {
        this.createStaticWater(mesh, props, material)
      }
      return
    }
    if (effectiveMode === 'dynamic') {
      this.applyDynamicUniforms(props, material)
    } else {
      this.applyStaticUniforms(props, material)
    }
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

  private createRebuildSignature(
    props: WaterComponentProps,
    materialSignature: string,
    effectiveMode: Exclude<WaterImplementationMode, 'auto'>,
  ): string {
    return [effectiveMode, props.textureWidth, props.textureHeight, materialSignature].join('_')
  }

  private createDynamicWater(mesh: Mesh, props: WaterComponentProps, material: Material | null): void {
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
    this.applyDynamicUniforms(props, material)
    this.syncSunUniforms()
  }

  private createStaticWater(mesh: Mesh, props: WaterComponentProps, material: Material | null): void {
    const baseGeometry = mesh.geometry?.clone?.() as BufferGeometry | undefined
    const resolvedGeometry = baseGeometry ?? new BufferGeometry()
    this.waterGeometry = resolvedGeometry

    const normalTexture = this.prepareNormalTexture(this.resolveMaterialNormalMap(material))
    this.normalTexture = normalTexture

    const staticMaterial = new MeshStandardMaterial({
      color: this.resolveMaterialColor(material),
      transparent: Boolean((material as Material | null)?.transparent),
      opacity: typeof (material as Material | null)?.opacity === 'number'
        ? (material as Material).opacity
        : WATER_DEFAULT_ALPHA,
      metalness: 0,
      roughness: 0.08,
    })
    staticMaterial.normalMap = normalTexture
    staticMaterial.envMapIntensity = 1
    this.staticWaterMaterial = staticMaterial

    const typedWaterMesh = new ThreeMesh(resolvedGeometry, staticMaterial) as unknown as Mesh
    typedWaterMesh.name = `${mesh.name ?? 'Water'} (Static)`
    typedWaterMesh.userData = typedWaterMesh.userData ?? {}
    typedWaterMesh.userData[COMPONENT_ARTIFACT_KEY] = true
    typedWaterMesh.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = this.context.nodeId
    typedWaterMesh.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = this.context.componentId
    typedWaterMesh.renderOrder = mesh.renderOrder

    const envTarget = new WebGLCubeRenderTarget(WATER_STATIC_ENVMAP_SIZE)
    envTarget.texture.generateMipmaps = false
    envTarget.texture.minFilter = LinearFilter
    this.staticEnvTarget = envTarget

    const envCamera = new CubeCamera(0.1, 2000, envTarget)
    this.staticEnvCamera = envCamera

    const parent = mesh.parent
    if (parent) {
      typedWaterMesh.position.copy(mesh.position)
      typedWaterMesh.quaternion.copy(mesh.quaternion)
      typedWaterMesh.scale.copy(mesh.scale)
      parent.add(typedWaterMesh)
      parent.add(envCamera)
      this.waterParent = parent
      mesh.visible = false
    } else {
      mesh.add(typedWaterMesh)
      mesh.add(envCamera)
      this.waterParent = mesh
    }

    this.staticWaterMesh = typedWaterMesh
    this.staticEnvHasCaptured = false
    this.staticEnvNeedsCapture = false
    this.staticEnvLastCapturedWorldPos = null

    const self = this
    typedWaterMesh.onBeforeRender = function (renderer: WebGLRenderer, scene: Scene) {
      self.maybeCaptureStaticEnvMap(renderer, scene)
    }

    this.applyStaticUniforms(props, material)
    this.syncSunUniforms()
  }

  private syncWaterTransform(target: Object3D): void {
    if (!this.hostMesh) {
      return
    }
    // Keep the surface aligned with the host mesh even though it's not parented under it.
    target.position.copy(this.hostMesh.position)
    target.quaternion.copy(this.hostMesh.quaternion)
    target.scale.copy(this.hostMesh.scale)
    target.updateMatrix()
    target.updateMatrixWorld(true)
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

  private applyDynamicUniforms(props: WaterComponentProps, material: Material | null): void {
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

  private applyStaticUniforms(props: WaterComponentProps, material: Material | null): void {
    if (!this.staticWaterMesh || !this.staticWaterMaterial) {
      return
    }
    this.staticWaterMaterial.color.copy(this.resolveMaterialColor(material))
    const opacity = typeof (material as Material | null)?.opacity === 'number' ? (material as Material).opacity : WATER_DEFAULT_ALPHA
    this.staticWaterMaterial.opacity = opacity
    this.staticWaterMaterial.transparent = Boolean((material as Material | null)?.transparent) || opacity < 0.999

    // Use existing wave params to approximate Water.js look:
    // - `size` controls normal tiling
    // - `distortionScale * waveStrength` controls normal strength
    const tiling = Math.min(16, Math.max(0.5, 8 / Math.max(0.001, props.size)))
    if (this.normalTexture) {
      this.normalTexture.repeat.set(tiling, tiling)
      this.normalTexture.wrapS = RepeatWrapping
      this.normalTexture.wrapT = RepeatWrapping
    }

    const strength = Math.max(0, props.distortionScale * props.waveStrength)
    const normalScale = Math.min(1.5, strength * 0.08)
    this.staticWaterMaterial.normalScale.set(normalScale, normalScale)

    // Ensure capture happens the first time it becomes visible.
    if (!this.staticEnvHasCaptured) {
      this.staticEnvNeedsCapture = true
    }
  }

  private tickStaticNormalScroll(deltaTime: number, props: WaterComponentProps): void {
    if (!this.normalTexture || !this.staticWaterMaterial) {
      return
    }
    const dx = typeof props.flowDirection?.x === 'number' ? props.flowDirection.x : DEFAULT_FLOW_DIRECTION.x
    const dy = typeof props.flowDirection?.y === 'number' ? props.flowDirection.y : DEFAULT_FLOW_DIRECTION.y
    this.resolvedFlowDirection.set(dx, dy)
    if (this.resolvedFlowDirection.lengthSq() <= 1e-6) {
      this.resolvedFlowDirection.set(DEFAULT_FLOW_DIRECTION.x, DEFAULT_FLOW_DIRECTION.y)
    } else {
      this.resolvedFlowDirection.normalize()
    }

    const speed = (Number.isFinite(props.flowSpeed) ? props.flowSpeed : WATER_DEFAULT_FLOW_SPEED) * this.staticNormalScrollSpeed
    if (Math.abs(speed) <= 1e-9) {
      return
    }
    this.flowOffset.x = (this.flowOffset.x + this.resolvedFlowDirection.x * speed * deltaTime) % 1
    this.flowOffset.y = (this.flowOffset.y + this.resolvedFlowDirection.y * speed * deltaTime) % 1
    if (this.flowOffset.x < 0) this.flowOffset.x += 1
    if (this.flowOffset.y < 0) this.flowOffset.y += 1
    this.normalTexture.offset.copy(this.flowOffset)
  }

  private markStaticEnvCaptureIfMoved(): void {
    if (!this.hostMesh) {
      return
    }
    const current = new Vector3()
    this.hostMesh.getWorldPosition(current)
    if (!this.staticEnvLastCapturedWorldPos) {
      return
    }
    const dx = current.x - this.staticEnvLastCapturedWorldPos.x
    const dy = current.y - this.staticEnvLastCapturedWorldPos.y
    const dz = current.z - this.staticEnvLastCapturedWorldPos.z
    if (dx * dx + dy * dy + dz * dz > 1e-6) {
      this.staticEnvNeedsCapture = true
    }
  }

  private maybeCaptureStaticEnvMap(renderer: WebGLRenderer, scene: Scene): void {
    if (!this.staticWaterMesh || !this.staticWaterMaterial || !this.staticEnvCamera || !this.staticEnvTarget) {
      return
    }
    if (this.staticEnvIsCapturing) {
      return
    }
    if (this.staticEnvHasCaptured && !this.staticEnvNeedsCapture) {
      return
    }
    if (!this.hostMesh) {
      return
    }

    const worldPos = new Vector3()
    this.hostMesh.getWorldPosition(worldPos)

    this.staticEnvIsCapturing = true
    const wasVisible = this.staticWaterMesh.visible
    this.staticWaterMesh.visible = false
    try {
      if (this.staticEnvCamera.parent) {
        const local = this.staticEnvCamera.parent.worldToLocal(worldPos.clone())
        this.staticEnvCamera.position.copy(local)
      } else {
        this.staticEnvCamera.position.copy(worldPos)
      }
      this.staticEnvCamera.updateMatrixWorld(true)
      this.staticEnvCamera.update(renderer, scene)
      this.staticWaterMaterial.envMap = this.staticEnvTarget.texture
      this.staticWaterMaterial.needsUpdate = true
      this.staticEnvHasCaptured = true
      this.staticEnvNeedsCapture = false
      this.staticEnvLastCapturedWorldPos = worldPos.clone()
    } finally {
      this.staticWaterMesh.visible = wasVisible
      this.staticEnvIsCapturing = false
    }
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
    if (this.staticWaterMesh) {
      this.waterParent?.remove(this.staticWaterMesh)
      this.staticWaterMesh.onBeforeRender = null as any
      this.staticWaterMesh = null
      this.meshVisibility(true)
    }
    if (this.staticEnvCamera) {
      this.waterParent?.remove(this.staticEnvCamera)
      this.staticEnvCamera = null
    }
    if (this.staticEnvTarget) {
      this.staticEnvTarget.dispose()
      this.staticEnvTarget = null
    }
    if (this.staticWaterMaterial) {
      this.staticWaterMaterial.dispose()
      this.staticWaterMaterial = null
    }
    this.staticEnvHasCaptured = false
    this.staticEnvNeedsCapture = false
    this.staticEnvIsCapturing = false
    this.staticEnvLastCapturedWorldPos = null
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
    this.waterParent = null
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
