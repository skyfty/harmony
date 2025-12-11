import * as THREE from 'three'
import { ShaderLib, UniformsUtils } from 'three'
import type {
  SceneSkyboxSettings,
  SceneCloudSettings,
  SceneCloudImplementation,
  SceneCubeTextureCloudSettings,
  SceneSphericalCloudSettings,
  SceneVolumetricCloudSettings,
} from '@harmony/schema'

export interface CloudAssetResolution {
  url: string
  dispose?: () => void
}

export type CloudAssetResolver = (source: string) => Promise<CloudAssetResolution | null>

const DEFAULT_CUBE_TEXTURE_SETTINGS: SceneCubeTextureCloudSettings = {
  mode: 'cubeTexture',
  positiveX: '',
  negativeX: '',
  positiveY: '',
  negativeY: '',
  positiveZ: '',
  negativeZ: '',
  intensity: 0.6,
}

const DEFAULT_SPHERICAL_SETTINGS: SceneSphericalCloudSettings = {
  mode: 'spherical',
  textureAssetId: null,
  radius: 900,
  opacity: 0.65,
  rotationSpeed: 0.015,
  color: '#ffffff',
  height: 400,
}

const DEFAULT_VOLUMETRIC_SETTINGS: SceneVolumetricCloudSettings = {
  mode: 'volumetric',
  color: '#ffffff',
  density: 0.45,
  speed: 0.25,
  detail: 4,
  coverage: 0.55,
  height: 500,
  size: 2400,
}

const DEFAULT_SETTINGS: Record<SceneCloudImplementation, SceneCloudSettings> = {
  cubeTexture: DEFAULT_CUBE_TEXTURE_SETTINGS,
  spherical: DEFAULT_SPHERICAL_SETTINGS,
  volumetric: DEFAULT_VOLUMETRIC_SETTINGS,
}

function ensureNumber(candidate: unknown, fallback: number): number {
  const value = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
  return value
}

function ensureString(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate : ''
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function approxEqual(a: number, b: number, epsilon = 1e-4): boolean {
  return Math.abs(a - b) <= epsilon
}

function cloneCubeSettings(settings: SceneCubeTextureCloudSettings): SceneCubeTextureCloudSettings {
  return {
    mode: 'cubeTexture',
    positiveX: settings.positiveX,
    negativeX: settings.negativeX,
    positiveY: settings.positiveY,
    negativeY: settings.negativeY,
    positiveZ: settings.positiveZ,
    negativeZ: settings.negativeZ,
    intensity: settings.intensity,
  }
}

function cloneSphericalSettings(settings: SceneSphericalCloudSettings): SceneSphericalCloudSettings {
  return {
    mode: 'spherical',
    textureAssetId: settings.textureAssetId,
    radius: settings.radius,
    opacity: settings.opacity,
    rotationSpeed: settings.rotationSpeed,
    color: settings.color,
    height: settings.height,
  }
}

function cloneVolumetricSettings(settings: SceneVolumetricCloudSettings): SceneVolumetricCloudSettings {
  return {
    mode: 'volumetric',
    color: settings.color,
    density: settings.density,
    speed: settings.speed,
    detail: settings.detail,
    coverage: settings.coverage,
    height: settings.height,
    size: settings.size,
  }
}

function sanitizeCubeSettings(input: SceneCubeTextureCloudSettings | null | undefined): SceneCubeTextureCloudSettings {
  const fallback = DEFAULT_CUBE_TEXTURE_SETTINGS
  return {
    mode: 'cubeTexture',
    positiveX: ensureString(input?.positiveX).trim(),
    negativeX: ensureString(input?.negativeX).trim(),
    positiveY: ensureString(input?.positiveY).trim(),
    negativeY: ensureString(input?.negativeY).trim(),
    positiveZ: ensureString(input?.positiveZ).trim(),
    negativeZ: ensureString(input?.negativeZ).trim(),
    intensity: clampNumber(ensureNumber(input?.intensity, fallback.intensity), 0, 1),
  }
}

function sanitizeSphericalSettings(input: SceneSphericalCloudSettings | null | undefined): SceneSphericalCloudSettings {
  const fallback = DEFAULT_SPHERICAL_SETTINGS
  return {
    mode: 'spherical',
    textureAssetId: ensureString(input?.textureAssetId ?? '').trim() || null,
    radius: clampNumber(ensureNumber(input?.radius, fallback.radius), 50, 10000),
    opacity: clampNumber(ensureNumber(input?.opacity, fallback.opacity), 0, 1),
    rotationSpeed: ensureNumber(input?.rotationSpeed, fallback.rotationSpeed),
    color: ensureString(input?.color).trim() || fallback.color,
    height: clampNumber(ensureNumber(input?.height, fallback.height), 0, 5000),
  }
}

function sanitizeVolumetricSettings(input: SceneVolumetricCloudSettings | null | undefined): SceneVolumetricCloudSettings {
  const fallback = DEFAULT_VOLUMETRIC_SETTINGS
  return {
    mode: 'volumetric',
    color: ensureString(input?.color).trim() || fallback.color,
    density: clampNumber(ensureNumber(input?.density, fallback.density), 0, 1.5),
    speed: clampNumber(ensureNumber(input?.speed, fallback.speed), -5, 5),
    detail: clampNumber(ensureNumber(input?.detail, fallback.detail), 1, 12),
    coverage: clampNumber(ensureNumber(input?.coverage, fallback.coverage), 0, 1),
    height: clampNumber(ensureNumber(input?.height, fallback.height), 0, 5000),
    size: clampNumber(ensureNumber(input?.size, fallback.size), 100, 10000),
  }
}

export function sanitizeCloudSettings(input: SceneCloudSettings | null | undefined): SceneCloudSettings | null {
  if (!input) {
    return null
  }
  switch (input.mode) {
    case 'cubeTexture':
      return sanitizeCubeSettings(input)
    case 'spherical':
      return sanitizeSphericalSettings(input)
    case 'volumetric':
      return sanitizeVolumetricSettings(input)
    default:
      return null
  }
}

export function createDefaultCloudSettings(mode: SceneCloudImplementation): SceneCloudSettings {
  const defaults = DEFAULT_SETTINGS[mode]
  if (!defaults) {
    throw new Error(`Unsupported cloud implementation: ${mode}`)
  }
  return cloneCloudSettings(defaults)!
}

export function cloneCloudSettings(settings: SceneCloudSettings | null | undefined): SceneCloudSettings | null {
  if (!settings) {
    return null
  }
  switch (settings.mode) {
    case 'cubeTexture':
      return cloneCubeSettings(settings)
    case 'spherical':
      return cloneSphericalSettings(settings)
    case 'volumetric':
      return cloneVolumetricSettings(settings)
    default:
      return null
  }
}

export function cloudSettingsEqual(a: SceneCloudSettings | null | undefined, b: SceneCloudSettings | null | undefined): boolean {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  if (a.mode !== b.mode) {
    return false
  }
  switch (a.mode) {
    case 'cubeTexture': {
      const other = b as SceneCubeTextureCloudSettings
      return (
        a.positiveX === other.positiveX &&
        a.negativeX === other.negativeX &&
        a.positiveY === other.positiveY &&
        a.negativeY === other.negativeY &&
        a.positiveZ === other.positiveZ &&
        a.negativeZ === other.negativeZ &&
        approxEqual(a.intensity, other.intensity)
      )
    }
    case 'spherical': {
      const other = b as SceneSphericalCloudSettings
      return (
        a.textureAssetId === other.textureAssetId &&
        approxEqual(a.radius, other.radius) &&
        approxEqual(a.opacity, other.opacity) &&
        approxEqual(a.rotationSpeed, other.rotationSpeed) &&
        a.color === other.color &&
        approxEqual(a.height, other.height)
      )
    }
    case 'volumetric': {
      const other = b as SceneVolumetricCloudSettings
      return (
        a.color === other.color &&
        approxEqual(a.density, other.density) &&
        approxEqual(a.speed, other.speed) &&
        approxEqual(a.detail, other.detail) &&
        approxEqual(a.coverage, other.coverage) &&
        approxEqual(a.height, other.height) &&
        approxEqual(a.size, other.size)
      )
    }
    default:
      return false
  }
}

interface LoadedResource {
  dispose(): void
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | null | undefined) {
  if (!material) {
    return
  }
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeMaterial(entry))
    return
  }
  material.dispose?.()
}

function disposeGeometry(geometry: THREE.BufferGeometry | null | undefined) {
  geometry?.dispose?.()
}

function disposeObjectRecursive(object: THREE.Object3D | undefined | null) {
  if (!object) {
    return
  }
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      disposeMaterial(child.material)
      disposeGeometry(child.geometry)
    }
  })
}

export interface SceneCloudRendererOptions {
  scene: THREE.Scene
  assetResolver?: CloudAssetResolver
  textureLoader?: THREE.TextureLoader
  cubeTextureLoader?: THREE.CubeTextureLoader
}

export class SceneCloudRenderer {
  private scene: THREE.Scene
  private assetResolver?: CloudAssetResolver
  private textureLoader: THREE.TextureLoader
  private cubeTextureLoader: THREE.CubeTextureLoader
  private group: THREE.Group
  private resources: LoadedResource[] = []
  private currentSettings: SceneCloudSettings | null = null
  private updateToken = 0
  private volumetricMaterial: THREE.ShaderMaterial | null = null
  private sphericalMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial> | null = null
  private volumetricMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null
  private cubeMesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null = null
  private accumulatedTime = 0

  constructor(options: SceneCloudRendererOptions) {
    this.scene = options.scene
    this.assetResolver = options.assetResolver
    this.textureLoader = options.textureLoader ?? new THREE.TextureLoader()
    this.cubeTextureLoader = options.cubeTextureLoader ?? new THREE.CubeTextureLoader()
    this.group = new THREE.Group()
    this.group.name = 'SceneCloudLayer'
    this.group.renderOrder = -1
  }

  setSkyboxSettings(settings: SceneSkyboxSettings | null): void {
    const sanitized = sanitizeCloudSettings(settings?.clouds ?? null)
    if (cloudSettingsEqual(this.currentSettings, sanitized)) {
      return
    }
    this.currentSettings = sanitized
    const token = ++this.updateToken
    void this.applySettingsAsync(sanitized, token)
  }

  update(deltaSeconds: number): void {
    if (!this.currentSettings) {
      return
    }
    this.accumulatedTime += deltaSeconds
    if (this.currentSettings.mode === 'spherical' && this.sphericalMesh) {
      const rotationSpeed = (this.currentSettings as SceneSphericalCloudSettings).rotationSpeed
      if (rotationSpeed !== 0) {
        this.sphericalMesh.rotation.y += rotationSpeed * deltaSeconds
      }
    } else if (this.currentSettings.mode === 'volumetric' && this.volumetricMaterial) {
      const volumetric = this.currentSettings as SceneVolumetricCloudSettings
      const uniforms = this.volumetricMaterial.uniforms
      if (uniforms?.uTime) {
        uniforms.uTime.value = this.accumulatedTime * volumetric.speed
      }
      if (uniforms?.uDensity) {
        uniforms.uDensity.value = volumetric.density
      }
      if (uniforms?.uCoverage) {
        uniforms.uCoverage.value = volumetric.coverage
      }
      if (uniforms?.uColor) {
        (uniforms.uColor.value as THREE.Color).set(volumetric.color)
      }
    }
  }

  dispose(): void {
    this.clearLayer()
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
    this.resources.forEach((entry) => entry.dispose())
    this.resources = []
    this.currentSettings = null
  }

  private async applySettingsAsync(settings: SceneCloudSettings | null, token: number): Promise<void> {
    this.clearLayer()
    if (!settings) {
      if (this.group.parent) {
        this.group.parent.remove(this.group)
      }
      return
    }
    if (!this.group.parent) {
      this.scene.add(this.group)
    }
    switch (settings.mode) {
      case 'cubeTexture':
        await this.applyCubeTextureSettings(settings, token)
        break
      case 'spherical':
        await this.applySphericalSettings(settings, token)
        break
      case 'volumetric':
        await this.applyVolumetricSettings(settings, token)
        break
      default:
        break
    }
  }

  private clearLayer(): void {
    this.resources.forEach((entry) => {
      try {
        entry.dispose()
      } catch (error) {
        console.warn('[SceneCloudRenderer] Failed to dispose cloud resource', error)
      }
    })
    this.resources = []
    if (this.cubeMesh) {
      disposeObjectRecursive(this.cubeMesh)
      this.group.remove(this.cubeMesh)
      this.cubeMesh = null
    }
    if (this.sphericalMesh) {
      disposeObjectRecursive(this.sphericalMesh)
      this.group.remove(this.sphericalMesh)
      this.sphericalMesh = null
    }
    if (this.volumetricMesh) {
      disposeObjectRecursive(this.volumetricMesh)
      this.group.remove(this.volumetricMesh)
      this.volumetricMesh = null
    }
    this.volumetricMaterial = null
    this.group.clear()
    this.accumulatedTime = 0
  }

  private async applyCubeTextureSettings(settings: SceneCubeTextureCloudSettings, token: number): Promise<void> {
    const faces = [
      settings.positiveX,
      settings.negativeX,
      settings.positiveY,
      settings.negativeY,
      settings.positiveZ,
      settings.negativeZ,
    ]
    if (faces.some((entry) => !entry)) {
      return
    }
    const resolved = await Promise.all(faces.map((face) => this.resolveAsset(face)))
    if (token !== this.updateToken) {
      resolved.forEach((entry) => entry?.dispose?.())
      return
    }
    if (resolved.some((entry) => !entry)) {
      resolved.forEach((entry) => entry?.dispose?.())
      return
    }
    const urls = resolved.map((entry) => entry!.url)
    let texture: THREE.CubeTexture
    try {
      texture = await this.cubeTextureLoader.loadAsync(urls)
    } catch (error) {
      console.warn('[SceneCloudRenderer] Failed to load cube texture faces', error)
      resolved.forEach((entry) => entry?.dispose?.())
      return
    }
    if (token !== this.updateToken) {
      texture.dispose()
      resolved.forEach((entry) => entry?.dispose?.())
      return
    }
    texture.colorSpace = THREE.SRGBColorSpace
    this.resources.push({
      dispose: () => {
        texture.dispose()
        resolved.forEach((entry) => entry?.dispose?.())
      },
    })
    const baseShader = ShaderLib.cube
    const uniforms = UniformsUtils.clone(baseShader.uniforms)
    if (!uniforms.tCube) {
      uniforms.tCube = { value: texture }
    } else {
      uniforms.tCube.value = texture
    }
    uniforms.cloudIntensity = { value: settings.intensity }
    const fragmentShader = baseShader.fragmentShader
      .replace(
        'uniform samplerCube tCube;',
        'uniform samplerCube tCube;\nuniform float cloudIntensity;',
      )
      .replace(
        'gl_FragColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );',
        'vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );\n\tgl_FragColor = vec4(texColor.rgb * cloudIntensity, texColor.a * cloudIntensity);',
      )
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: baseShader.vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: settings.intensity < 0.999,
    })
    const geometry = new THREE.BoxGeometry(settings.intensity > 0.9 ? 6000 : 4000, settings.intensity > 0.9 ? 6000 : 4000, settings.intensity > 0.9 ? 6000 : 4000)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'SceneCloudCube'
    mesh.frustumCulled = false
    this.cubeMesh = mesh
    this.group.add(mesh)
  }

  private async applySphericalSettings(settings: SceneSphericalCloudSettings, token: number): Promise<void> {
    let texture: THREE.Texture | null = null
    let disposeHandle: (() => void) | undefined
    if (settings.textureAssetId) {
      const resolved = await this.resolveAsset(settings.textureAssetId)
      if (token !== this.updateToken) {
        resolved?.dispose?.()
        return
      }
      if (resolved) {
        try {
          texture = await this.textureLoader.loadAsync(resolved.url)
        } catch (error) {
          console.warn('[SceneCloudRenderer] Failed to load spherical cloud texture', error)
          resolved.dispose?.()
          texture = null
        }
        if (!texture) {
          // fall back to color-only clouds
          disposeHandle = resolved.dispose?.bind(resolved)
        } else {
          if (token !== this.updateToken) {
            texture.dispose()
            resolved.dispose?.()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          texture.wrapS = THREE.RepeatWrapping
          texture.wrapT = THREE.RepeatWrapping
          disposeHandle = () => {
            texture?.dispose()
            resolved.dispose?.()
          }
        }
      }
    }
    const geometry = new THREE.SphereGeometry(settings.radius, 64, 32)
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(settings.color),
      map: texture ?? undefined,
      transparent: true,
      opacity: settings.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    material.needsUpdate = true
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'SceneCloudSphere'
    mesh.position.set(0, settings.height, 0)
    mesh.frustumCulled = false
    this.sphericalMesh = mesh
    this.group.add(mesh)
    if (disposeHandle) {
      this.resources.push({ dispose: disposeHandle })
    }
  }

  private async applyVolumetricSettings(settings: SceneVolumetricCloudSettings, token: number): Promise<void> {
    if (token !== this.updateToken) {
      return
    }
    const geometry = new THREE.PlaneGeometry(settings.size, settings.size, 1, 1)
    const uniforms = {
      uTime: { value: 0 },
      uDensity: { value: settings.density },
      uCoverage: { value: settings.coverage },
      uDetail: { value: settings.detail },
      uColor: { value: new THREE.Color(settings.color) },
    }
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uDensity;
        uniform float uCoverage;
        uniform float uDetail;
        uniform vec3 uColor;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float total = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 5; i++) {
            total += noise(p * frequency) * amplitude;
            frequency *= 2.0;
            amplitude *= 0.5;
          }
          return total;
        }

        void main() {
          vec2 uv = vUv * uDetail;
          float timeFactor = uTime * 0.05;
          float n = fbm(uv + vec2(timeFactor, timeFactor));
          float coverage = smoothstep(uCoverage, 1.0, n);
          float alpha = clamp(coverage * uDensity, 0.0, 1.0);
          gl_FragColor = vec4(uColor * coverage, alpha);
        }
      `,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'SceneCloudVolumetric'
    mesh.position.set(0, settings.height, 0)
    mesh.rotation.x = -Math.PI * 0.5
    mesh.frustumCulled = false
    this.volumetricMaterial = material
    this.volumetricMesh = mesh
    this.group.add(mesh)
  }

  private async resolveAsset(source: string): Promise<CloudAssetResolution | null> {
    const trimmed = typeof source === 'string' ? source.trim() : ''
    if (!trimmed) {
      return null
    }
    if (this.assetResolver) {
      const resolved = await this.assetResolver(trimmed)
      if (resolved) {
        return resolved
      }
    }
    return { url: trimmed }
  }
}
