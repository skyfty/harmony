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
  density: 0.38,
  coverage: 0.26,
  detail: 5,
  speed: 0.2,
  color: '#ffffff',
  size: 4000,
  height: 400,
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
    intensity: ensureNumber(input?.intensity, fallback.intensity),
  }
}

function sanitizeSphericalSettings(input: SceneSphericalCloudSettings | null | undefined): SceneSphericalCloudSettings {
  const fallback = DEFAULT_SPHERICAL_SETTINGS
  return {
    mode: 'spherical',
    textureAssetId: ensureString(input?.textureAssetId ?? '').trim() || null,
    radius: ensureNumber(input?.radius, fallback.radius),
    opacity: ensureNumber(input?.opacity, fallback.opacity),
    rotationSpeed: ensureNumber(input?.rotationSpeed, fallback.rotationSpeed),
    color: ensureString(input?.color).trim() || fallback.color,
    height: ensureNumber(input?.height, fallback.height),
  }
}

function sanitizeVolumetricSettings(input: SceneVolumetricCloudSettings | null | undefined): SceneVolumetricCloudSettings {
  const fallback = DEFAULT_VOLUMETRIC_SETTINGS
  return {
    mode: 'volumetric',
    color: ensureString(input?.color).trim() || fallback.color,
    density: ensureNumber(input?.density, fallback.density),
    speed: ensureNumber(input?.speed, fallback.speed),
    detail: ensureNumber(input?.detail, fallback.detail),
    coverage: ensureNumber(input?.coverage, fallback.coverage),
    height: ensureNumber(input?.height, fallback.height),
    size: ensureNumber(input?.size, fallback.size),
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
    const anyChild = child as unknown as { material?: THREE.Material | THREE.Material[]; geometry?: THREE.BufferGeometry }
    if (anyChild.material) {
      disposeMaterial(anyChild.material)
    }
    if (anyChild.geometry) {
      disposeGeometry(anyChild.geometry)
    }
  })
}

export interface SceneCloudRendererOptions {
    scene: THREE.Scene
    assetResolver?: CloudAssetResolver
  textureLoader?: THREE.TextureLoader
  cubeTextureLoader?: THREE.CubeTextureLoader
}

// --- Noise Generation for Cloud Baking ---
const PERM = new Uint8Array([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]);
const P = new Uint8Array(512);
for(let i=0; i<256; i++) P[i] = P[i+256] = PERM[i];

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number, z: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function noise3D(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(w, lerp(v, lerp(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)),
    lerp(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z))),
    lerp(v, lerp(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)),
      lerp(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1))));
}

function fbm(x: number, y: number, z: number, octaves: number) {
  let total = 0, amp = 0.5, freq = 1.0;
  for(let i=0; i<octaves; i++) {
    total += noise3D(x * freq, y * freq, z * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

function turbulence(x: number, y: number, z: number, octaves: number) {
  let total = 0, amp = 0.5, freq = 1.0;
  for(let i=0; i<octaves; i++) {
    total += Math.abs(noise3D(x * freq, y * freq, z * freq)) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

function generateCloudTexture(size: number): THREE.DataTexture {
  // Randomize noise permutation for unique clouds each time
  const p = new Uint8Array(256);
  for(let i=0; i<256; i++) p[i] = i;
  for(let i=255; i>0; i--) {
    const r = Math.floor(Math.random() * (i+1));
    const t = p[i]; p[i] = p[r]; p[r] = t;
  }
  for(let i=0; i<256; i++) P[i] = P[i+256] = p[i];

  const data = new Uint8Array(size * size * 4);
  // Use 3D noise sampled on a cylinder surface to make it seamless horizontally
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const angle = (x / size) * Math.PI * 2;
      // Lower radius/scale = Larger cloud features
      const radius = 0.8; 
      const nx = Math.cos(angle) * radius;
      const nz = Math.sin(angle) * radius;
      const ny = (y / size) * 2.0; 

      // R: Base - FBM
      let n1 = fbm(nx, ny, nz, 6);
      n1 = n1 * 0.5 + 0.5; // 0..1
      
      // Remap to make clouds denser but with more gaps
      // min: threshold for "0" (sky) - Higher value = more gaps
      // max: threshold for "1" (dense cloud) - Lower value = denser/brighter clouds
      const min = 0.25; 
      const max = 0.6; 
      let t = (n1 - min) / (max - min);
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      n1 = t * t * (3 - 2 * t);

      // G: Detail - Turbulence for fluffiness
      // Higher frequency (x3.5) for finer details
      let n2 = turbulence((nx + 10) * 3.5, (ny + 10) * 3.5, (nz + 10) * 3.5, 7);
      // Enhance detail contrast
      n2 = Math.pow(n2, 1.3);
      n2 = n2 < 0 ? 0 : (n2 > 1 ? 1 : n2);

      // B: Warp
      let n3 = fbm(nx + 20, ny + 20, nz + 20, 3);
      n3 = n3 * 0.5 + 0.5;

      const i = (y * size + x) * 4;
      data[i] = Math.floor(n1 * 255);
      data[i + 1] = Math.floor(n2 * 255);
      data[i + 2] = Math.floor(n3 * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
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
  private volumetricMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null
  private cubeMesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null = null
  private accumulatedTime = 0
  private cloudTexture: THREE.Texture | null = null

  constructor(options: SceneCloudRendererOptions) {
    this.scene = options.scene
    this.assetResolver = options.assetResolver
    this.textureLoader = options.textureLoader ?? new THREE.TextureLoader()
    this.cubeTextureLoader = options.cubeTextureLoader ?? new THREE.CubeTextureLoader()
    this.group = new THREE.Group()
    this.group.name = 'SceneCloudLayer'
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
      const uniforms = (this.volumetricMaterial as THREE.ShaderMaterial).uniforms
      if (uniforms?.uTime) {
        uniforms.uTime.value = this.accumulatedTime
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
    this.cloudTexture?.dispose()
    this.cloudTexture = null
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
    mesh.position.set(0, 0, 0)
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

    if (!this.cloudTexture) {
      this.cloudTexture = generateCloudTexture(512)
    }

    // Volumetric clouds are approximated using a custom shader on a sky-sized sphere.
    // Volumetric clouds rendered as a large inverted sphere that encloses the camera.
    const radius = 500
    // 仅构建上半球几何体，避免对地面以下区域进行不必要的片元着色
    const geometry = new THREE.SphereGeometry(radius, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.5)

    const detail = THREE.MathUtils.clamp(settings.detail ?? 5, 0, 10) / 10.0
    const uniforms = {
      uTime: { value: 0 },
      uSunPos: { value: new THREE.Vector3(100, 200, -100) }, // Initial sun direction in world space
      uCloudTexture: { value: this.cloudTexture },
      uCloudColor: { value: new THREE.Color(settings.color) },
      uCloudParams: { value: new THREE.Vector4(settings.density, settings.coverage, detail, settings.speed) }
    }

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
            varying vec3 vWorldPosition;
            varying vec2 vUv;

            void main() {
                vUv = uv;
                // 获取世界坐标，用于计算天空梯度和噪声采样
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunPos; // 太阳在世界坐标中的位置
        uniform sampler2D uCloudTexture;
        uniform vec3 uCloudColor;
        uniform vec4 uCloudParams; // x: density, y: coverage, z: detail, w: speed

        varying vec3 vWorldPosition;
        varying vec2 vUv;

        void main() {
            // 归一化的视线方向
            vec3 viewDir = normalize(vWorldPosition);
            vec3 sunDir = normalize(uSunPos);

            // 下半球直接丢弃，避免对地面以下像素做噪声和光照计算
            if (vWorldPosition.y < 0.0) {
                discard;
            }

            // --- 2. 与太阳方向的夹角，用于后续云光照 ---
            float sunDot = dot(viewDir, sunDir);

            // --- 3. 生成云层 (使用烘培纹理) ---
            float speed = uCloudParams.w * 0.01;
            // 简单的UV动画模拟云层移动
            vec2 uv = vUv * 3.0 + vec2(uTime * speed, 0.0);
            
            vec4 noiseVal = texture2D(uCloudTexture, uv);
            float baseNoise = noiseVal.r;
            float detailNoise = noiseVal.g;
            // float warp = noiseVal.b; // 可以用于扭曲UV

            float coverage = uCloudParams.y;
            float density = uCloudParams.x;
            
            // Mix noise
            float noise = baseNoise;
            // Add detail based on detail param
            noise = mix(noise, detailNoise, uCloudParams.z * 0.5);
            
            // Thresholding for cloud shape
            float cloudVal = smoothstep(1.0 - coverage, 1.0 - coverage + 0.2, noise);
            
            // Density
            // Boost density to make clouds appear thicker and more solid
            float alpha = cloudVal * density * 2.5;
            alpha = clamp(alpha, 0.0, 1.0);
            
            // Horizon fade
            float horizonFade = smoothstep(0.0, 0.2, viewDir.y);
            alpha *= horizonFade;

            if (alpha < 0.01) discard;

            // --- 云层颜色与光照 ---
            vec3 cloudBaseColor = uCloudColor;
            // Simulate thickness: denser parts absorb more light (darker shadows)
            // Brightened shadows to avoid too dark clouds away from sun
            vec3 cloudShadowColor = uCloudColor * mix(0.8, 0.5, cloudVal);
            
            float lightIntensity = clamp(sunDot * 0.5 + 0.5, 0.0, 1.0);
            lightIntensity = smoothstep(0.2, 0.8, lightIntensity); // Enhance contrast
            
            // Mix: ensure even darkest parts get some light (ambient)
            vec3 finalColor = mix(cloudShadowColor, cloudBaseColor, lightIntensity * 0.7 + 0.3);
            
            // Silver lining
            float silverLining = smoothstep(0.8, 1.0, sunDot) * (1.0 - alpha);
            finalColor += vec3(1.0) * silverLining * 0.4;

            gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })

    this.volumetricMaterial = material

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'SceneCloudVolumetric'
    mesh.position.set(0, 0, 0)
    mesh.frustumCulled = false
    mesh.renderOrder = 1000

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
