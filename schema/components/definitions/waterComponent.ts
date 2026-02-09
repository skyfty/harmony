import type { Camera, Material, Mesh, Object3D, Texture } from 'three'
import {
  BufferGeometry,
  Color,
  DataTexture,
  Matrix4,
  LinearFilter,
  Mesh as ThreeMesh,
  PerspectiveCamera,
  Plane,
  UniformsLib,
  UniformsUtils,
  
  RepeatWrapping,
  NoColorSpace,
  ShaderMaterial,
  Vector4,
  WebGLRenderTarget,
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
  private staticWaterMaterial: ShaderMaterial | null = null
  private staticMirrorTarget: WebGLRenderTarget | null = null
  private staticMirrorCamera: PerspectiveCamera | null = null
  private staticTextureMatrix = new Matrix4()
  private staticMirrorPlane = new Plane()
  private staticClipPlane = new Vector4()
  private staticMirrorWorldPosition = new Vector3()
  private staticCameraWorldPosition = new Vector3()
  private staticRotationMatrix = new Matrix4()
  private staticNormal = new Vector3()
  private staticView = new Vector3()
  private staticTarget = new Vector3()
  private staticQ = new Vector4()
  private staticEnvHasCaptured = false
  private staticEnvNeedsCapture = false
  private staticEnvIsCapturing = false
  private staticEnvLastCapturedWorldPos: Vector3 | null = null
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
      this.tickStaticShaderTime(deltaTime, props.flowSpeed)
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

  private createStaticWaterShaderMaterial(
    props: WaterComponentProps,
    baseMaterial: Material | null,
    normalTexture: Texture,
  ): ShaderMaterial {
    const opacity = typeof (baseMaterial as Material | null)?.opacity === 'number' ? (baseMaterial as Material).opacity : WATER_DEFAULT_ALPHA
    const transparent = Boolean((baseMaterial as Material | null)?.transparent) || opacity < 0.999
    const waterColor = this.resolveMaterialColor(baseMaterial)
    const distortionScale = Math.max(WATER_MIN_DISTORTION_SCALE, props.distortionScale * props.waveStrength)

    normalTexture.wrapS = RepeatWrapping
    normalTexture.wrapT = RepeatWrapping
    normalTexture.needsUpdate = true

    const uniforms = UniformsUtils.merge([
      UniformsLib['fog'],
      UniformsLib['lights'],
      {
        normalSampler: { value: normalTexture },
        mirrorSampler: { value: null },
        alpha: { value: opacity },
        time: { value: 0.0 },
        size: { value: props.size },
        distortionScale: { value: distortionScale },
        textureMatrix: { value: new Matrix4() },
        sunColor: { value: new Color(0xffffff) },
        sunDirection: { value: new Vector3(0.70707, 0.70707, 0).normalize() },
        eye: { value: new Vector3() },
        waterColor: { value: waterColor },
      },
    ])

    return new ShaderMaterial({
      transparent,
      opacity,
      depthWrite: !transparent,
      uniforms,
      lights: true,
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        uniform float time;

        varying vec4 mirrorCoord;
        varying vec4 worldPosition;

        #include <common>
        #include <fog_pars_vertex>
        #include <shadowmap_pars_vertex>
        #include <logdepthbuf_pars_vertex>

        void main() {
          mirrorCoord = modelMatrix * vec4( position, 1.0 );
          worldPosition = mirrorCoord.xyzw;
          mirrorCoord = textureMatrix * mirrorCoord;

          vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mvPosition;

          #include <beginnormal_vertex>
          #include <defaultnormal_vertex>
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
          #include <shadowmap_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D mirrorSampler;
        uniform sampler2D normalSampler;
        uniform float alpha;
        uniform float time;
        uniform float size;
        uniform float distortionScale;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform vec3 eye;
        uniform vec3 waterColor;

        varying vec4 mirrorCoord;
        varying vec4 worldPosition;

        #include <common>
        #include <packing>
        #include <bsdfs>
        #include <fog_pars_fragment>
        #include <lights_pars_begin>
        #include <shadowmap_pars_fragment>
        #include <shadowmask_pars_fragment>
        #include <logdepthbuf_pars_fragment>

        vec4 getNoise(vec2 uv) {
          vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0);
          vec2 uv1 = (uv / 107.0) - vec2(time / -19.0, time / 31.0);
          vec2 uv2 = (uv / vec2(8907.0, 9803.0)) + vec2(time / 101.0, time / 97.0);
          vec2 uv3 = (uv / vec2(1091.0, 1027.0)) - vec2(time / 109.0, time / -113.0);
          vec4 noise = texture2D(normalSampler, uv0) +
            texture2D(normalSampler, uv1) +
            texture2D(normalSampler, uv2) +
            texture2D(normalSampler, uv3);
          return noise * 0.5 - 1.0;
        }

        void sunLight(
          const vec3 surfaceNormal,
          const vec3 eyeDirection,
          float shiny,
          float spec,
          float diffuse,
          inout vec3 diffuseColor,
          inout vec3 specularColor
        ) {
          vec3 reflectionDir = normalize(reflect(-sunDirection, surfaceNormal));
          float direction = max(0.0, dot(eyeDirection, reflectionDir));
          specularColor += pow(direction, shiny) * sunColor * spec;
          diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;
        }

        void main() {
          #include <logdepthbuf_fragment>

          vec3 worldToEye = eye - worldPosition.xyz;
          vec3 eyeDirection = normalize(worldToEye);
          float distance = max(0.0001, length(worldToEye));

          vec4 noise = getNoise(worldPosition.xz * size);
          vec3 surfaceNormal = normalize(noise.xzy * vec3(1.5, 1.0, 1.5));

          vec3 diffuseLight = vec3(0.0);
          vec3 specularLight = vec3(0.0);
          sunLight(surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight);

          float theta = max(dot(eyeDirection, surfaceNormal), 0.0);
          float rf0 = 0.3;
          float reflectance = rf0 + (1.0 - rf0) * pow((1.0 - theta), 5.0);

          float distortionAmount = (0.001 + 1.0 / distance) * distortionScale;
          vec2 distortion = surfaceNormal.xz * distortionAmount;
          vec3 reflectionSample = vec3(texture2D(mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion));
          vec3 scatter = max(0.0, dot(surfaceNormal, eyeDirection)) * waterColor;

          float shadowMask = getShadowMask();

          vec3 albedo = mix(
            (sunColor * diffuseLight * 0.3 + scatter) * shadowMask,
            (vec3(0.1) + reflectionSample * 0.9 + reflectionSample * specularLight),
            reflectance
          );

          gl_FragColor = vec4(albedo, alpha);

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    })
  }

  private createStaticWater(mesh: Mesh, props: WaterComponentProps, material: Material | null): void {
    const baseGeometry = mesh.geometry?.clone?.() as BufferGeometry | undefined
    const resolvedGeometry = baseGeometry ?? new BufferGeometry()
    this.waterGeometry = resolvedGeometry

    const normalTexture = this.prepareNormalTexture(this.resolveMaterialNormalMap(material))
    this.normalTexture = normalTexture

    const staticMaterial = this.createStaticWaterShaderMaterial(props, material, normalTexture)
    this.staticWaterMaterial = staticMaterial

    const typedWaterMesh = new ThreeMesh(resolvedGeometry, staticMaterial) as unknown as Mesh
    typedWaterMesh.name = `${mesh.name ?? 'Water'} (Static)`
    typedWaterMesh.userData = typedWaterMesh.userData ?? {}
    typedWaterMesh.userData[COMPONENT_ARTIFACT_KEY] = true
    typedWaterMesh.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = this.context.nodeId
    typedWaterMesh.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = this.context.componentId
    typedWaterMesh.renderOrder = mesh.renderOrder

    const mirrorTarget = new WebGLRenderTarget(
      Math.max(WATER_MIN_TEXTURE_SIZE, Math.floor(props.textureWidth)),
      Math.max(WATER_MIN_TEXTURE_SIZE, Math.floor(props.textureHeight)),
    )
    mirrorTarget.texture.generateMipmaps = false
    mirrorTarget.texture.minFilter = LinearFilter
    this.staticMirrorTarget = mirrorTarget

    const mirrorCamera = new PerspectiveCamera()
    this.staticMirrorCamera = mirrorCamera

    const parent = mesh.parent
    if (parent) {
      typedWaterMesh.position.copy(mesh.position)
      typedWaterMesh.quaternion.copy(mesh.quaternion)
      typedWaterMesh.scale.copy(mesh.scale)
      parent.add(typedWaterMesh)
      parent.add(mirrorCamera)
      this.waterParent = parent
      mesh.visible = false
    } else {
      mesh.add(typedWaterMesh)
      mesh.add(mirrorCamera)
      this.waterParent = mesh
    }

    this.staticWaterMesh = typedWaterMesh
    this.staticEnvHasCaptured = false
    this.staticEnvNeedsCapture = false
    this.staticEnvLastCapturedWorldPos = null

    const self = this
    typedWaterMesh.onBeforeRender = function (renderer: WebGLRenderer, scene: Scene, camera: Camera) {
      self.syncStaticEyeUniform(camera)
      self.maybeCaptureStaticMirror(renderer, scene, camera)
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
    const opacity = typeof (material as Material | null)?.opacity === 'number' ? (material as Material).opacity : WATER_DEFAULT_ALPHA
    const transparent = Boolean((material as Material | null)?.transparent) || opacity < 0.999
    this.staticWaterMaterial.transparent = transparent
    this.staticWaterMaterial.opacity = opacity
    this.staticWaterMaterial.depthWrite = !transparent

    const uniforms = this.staticWaterMaterial.uniforms as Record<string, { value: any }>
    if (uniforms.waterColor?.value && uniforms.waterColor.value instanceof Color) {
      uniforms.waterColor.value.copy(this.resolveMaterialColor(material))
    }
    if (uniforms.alpha) {
      uniforms.alpha.value = opacity
    }
    if (uniforms.size) {
      uniforms.size.value = props.size
    }
    if (uniforms.distortionScale) {
      uniforms.distortionScale.value = Math.max(WATER_MIN_DISTORTION_SCALE, props.distortionScale * props.waveStrength)
    }

    // Keep material's textureMatrix uniform object stable; we update its value during mirror capture.
    if (uniforms.textureMatrix?.value instanceof Matrix4) {
      // no-op
    }

    // Ensure capture happens the first time it becomes visible.
    if (!this.staticEnvHasCaptured) {
      this.staticEnvNeedsCapture = true
    }
  }

  private tickStaticShaderTime(deltaTime: number, flowSpeed: number): void {
    if (!this.staticWaterMaterial) {
      return
    }
    const uniforms = this.staticWaterMaterial.uniforms as Record<string, { value: any }>
    if (!uniforms.time) {
      return
    }
    const speed = Number.isFinite(flowSpeed) ? flowSpeed : WATER_DEFAULT_FLOW_SPEED
    const current = typeof uniforms.time.value === 'number' ? uniforms.time.value : 0
    uniforms.time.value = current + deltaTime * speed
  }

  private syncStaticEyeUniform(camera: Camera): void {
    if (!this.staticWaterMaterial) {
      return
    }
    const uniforms = this.staticWaterMaterial.uniforms as Record<string, { value: any }>
    const eye = uniforms.eye?.value
    if (eye && eye instanceof Vector3) {
      eye.setFromMatrixPosition(camera.matrixWorld)
    }
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

  private maybeCaptureStaticMirror(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    if (!this.staticWaterMesh || !this.staticWaterMaterial || !this.staticMirrorCamera || !this.staticMirrorTarget) {
      return
    }
    if (this.staticEnvIsCapturing) {
      return
    }
    if (this.staticEnvHasCaptured && !this.staticEnvNeedsCapture) {
      return
    }

    const scope = this.staticWaterMesh
    const mirrorCamera = this.staticMirrorCamera

    // Mirror world position is the plane position.
    this.staticMirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld)
    this.staticCameraWorldPosition.setFromMatrixPosition(camera.matrixWorld)

    this.staticRotationMatrix.extractRotation(scope.matrixWorld)

    // Water.js assumes plane normal is +Z in local space.
    this.staticNormal.set(0, 0, 1)
    this.staticNormal.applyMatrix4(this.staticRotationMatrix)

    this.staticView.subVectors(this.staticMirrorWorldPosition, this.staticCameraWorldPosition)

    // Avoid rendering when mirror is facing away.
    if (this.staticView.dot(this.staticNormal) > 0) {
      return
    }

    // Compute mirror camera position.
    this.staticView.reflect(this.staticNormal).negate()
    this.staticView.add(this.staticMirrorWorldPosition)

    this.staticRotationMatrix.extractRotation(camera.matrixWorld)
    const lookAtPosition = new Vector3(0, 0, -1)
    lookAtPosition.applyMatrix4(this.staticRotationMatrix)
    lookAtPosition.add(this.staticCameraWorldPosition)

    this.staticTarget.subVectors(this.staticMirrorWorldPosition, lookAtPosition)
    this.staticTarget.reflect(this.staticNormal).negate()
    this.staticTarget.add(this.staticMirrorWorldPosition)

    mirrorCamera.position.copy(this.staticView)
    mirrorCamera.up.set(0, 1, 0)
    mirrorCamera.up.applyMatrix4(this.staticRotationMatrix)
    mirrorCamera.up.reflect(this.staticNormal)
    mirrorCamera.lookAt(this.staticTarget)

    // Match camera projection.
    ;(mirrorCamera as any).near = (camera as any).near
    mirrorCamera.far = (camera as any).far
    mirrorCamera.updateMatrixWorld()
    mirrorCamera.projectionMatrix.copy((camera as any).projectionMatrix)

    // Update the texture matrix (Water.js style).
    this.staticTextureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    )
    this.staticTextureMatrix.multiply(mirrorCamera.projectionMatrix)
    this.staticTextureMatrix.multiply(mirrorCamera.matrixWorldInverse)

    // Oblique clip plane (Water.js style).
    this.staticMirrorPlane.setFromNormalAndCoplanarPoint(this.staticNormal, this.staticMirrorWorldPosition)
    this.staticMirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse)

    this.staticClipPlane.set(
      this.staticMirrorPlane.normal.x,
      this.staticMirrorPlane.normal.y,
      this.staticMirrorPlane.normal.z,
      this.staticMirrorPlane.constant,
    )

    const projectionMatrix = mirrorCamera.projectionMatrix
    this.staticQ.x = (Math.sign(this.staticClipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0]
    this.staticQ.y = (Math.sign(this.staticClipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5]
    this.staticQ.z = -1.0
    this.staticQ.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14]

    // Calculate the scaled plane vector.
    this.staticClipPlane.multiplyScalar(2.0 / this.staticClipPlane.dot(this.staticQ))

    // Replacing the third row of the projection matrix.
    projectionMatrix.elements[2] = this.staticClipPlane.x
    projectionMatrix.elements[6] = this.staticClipPlane.y
    projectionMatrix.elements[10] = this.staticClipPlane.z + 1.0
    projectionMatrix.elements[14] = this.staticClipPlane.w

    // Capture.
    this.staticEnvIsCapturing = true
    const wasVisible = scope.visible
    scope.visible = false
    const currentRenderTarget = renderer.getRenderTarget()
    const currentXrEnabled = renderer.xr.enabled
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate
    try {
      renderer.xr.enabled = false
      renderer.shadowMap.autoUpdate = false

      renderer.setRenderTarget(this.staticMirrorTarget)
      if ((renderer as any).autoClear === false) {
        renderer.clear()
      }
      renderer.render(scene, mirrorCamera)

      const uniforms = this.staticWaterMaterial.uniforms as Record<string, { value: any }>
      if (uniforms.mirrorSampler) {
        uniforms.mirrorSampler.value = this.staticMirrorTarget.texture
      }
      if (uniforms.textureMatrix?.value instanceof Matrix4) {
        uniforms.textureMatrix.value.copy(this.staticTextureMatrix)
      }

      this.staticWaterMaterial.needsUpdate = true
      this.staticEnvHasCaptured = true
      this.staticEnvNeedsCapture = false

      const worldPos = new Vector3()
      scope.getWorldPosition(worldPos)
      this.staticEnvLastCapturedWorldPos = worldPos
    } finally {
      renderer.xr.enabled = currentXrEnabled
      renderer.shadowMap.autoUpdate = currentShadowAutoUpdate
      renderer.setRenderTarget(currentRenderTarget)
      scope.visible = wasVisible
      this.staticEnvIsCapturing = false
    }
  }

  private syncSunUniforms(): void {
    const root = this.resolveSceneRoot(this.hostMesh ?? this.context.getRuntimeObject())
    const light = this.findSunLight(root)
    if (!light) {
      return
    }

    const direction = new Vector3()
    const targetPosition = new Vector3()
    light.target?.getWorldPosition(targetPosition)
    light.getWorldPosition(direction)
    direction.sub(targetPosition).normalize()

    const applyToShader = (shader: ShaderMaterial | null) => {
      if (!shader) {
        return
      }
      if (shader.uniforms?.sunDirection?.value && shader.uniforms.sunDirection.value instanceof Vector3) {
        shader.uniforms.sunDirection.value.copy(direction)
      }
      if (shader.uniforms?.sunColor?.value && shader.uniforms.sunColor.value instanceof Color) {
        shader.uniforms.sunColor.value.copy(light.color)
      }
    }

    applyToShader(this.waterInstance ? (this.waterInstance.material as ShaderMaterial) : null)
    applyToShader(this.staticWaterMaterial)
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
    if (this.staticMirrorCamera) {
      this.waterParent?.remove(this.staticMirrorCamera)
      this.staticMirrorCamera = null
    }
    if (this.staticMirrorTarget) {
      this.staticMirrorTarget.dispose()
      this.staticMirrorTarget = null
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
