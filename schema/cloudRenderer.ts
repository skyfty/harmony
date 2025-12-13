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

    const radius = 1000
    const geometry = new THREE.SphereGeometry(radius, 64, 32)

    const uniforms = {
      uTime: { value: 0 },
                uSunPos: { value: new THREE.Vector3(100, 200, -100) } // 太阳位置
    }

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
            varying vec3 vWorldPosition;
            varying vec3 vSunDirection;
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

            varying vec3 vWorldPosition;
            varying vec2 vUv;

            // --- 噪声函数库 (Simplex Noise 3D) ---
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

            float snoise(vec3 v) {
                const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

                // First corner
                vec3 i  = floor(v + dot(v, C.yyy) );
                vec3 x0 = v - i + dot(i, C.xxx) ;

                // Other corners
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min( g.xyz, l.zxy );
                vec3 i2 = max( g.xyz, l.zxy );

                vec3 x1 = x0 - i1 + C.xxx;
                vec3 x2 = x0 - i2 + C.yyy;
                vec3 x3 = x0 - D.yyy;

                i = mod289(i);
                vec4 p = permute( permute( permute(
                            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                        + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                        + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

                float n_ = 0.142857142857;
                vec3  ns = n_ * D.wyz - D.xzx;

                vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_ );

                vec4 x = x_ *ns.x + ns.yyyy;
                vec4 y = y_ *ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);

                vec4 b0 = vec4( x.xy, y.xy );
                vec4 b1 = vec4( x.zw, y.zw );

                vec4 s0 = floor(b0)*2.0 + 1.0;
                vec4 s1 = floor(b1)*2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));

                vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

                vec3 p0 = vec3(a0.xy,h.x);
                vec3 p1 = vec3(a0.zw,h.y);
                vec3 p2 = vec3(a1.xy,h.z);
                vec3 p3 = vec3(a1.zw,h.w);

                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;

                vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                            dot(p2,x2), dot(p3,x3) ) );
            }

            // --- FBM: 生成云的细节 ---
            float fbm(vec3 p) {
                float sum = 0.0;
                float amp = 0.5;
                float freq = 1.0;
                // 5层倍频
                for(int i = 0; i < 5; i++) {
                    sum += snoise(p * freq) * amp;
                    freq *= 2.02; // 稍微不是2.0，避免网格伪影
                    amp *= 0.5;
                }
                return sum;
            }

            vec3 fbmVec3(vec3 p) {
              return vec3(
                fbm(p + vec3(5.2, 1.3, 2.1)),
                fbm(p + vec3(9.1, 7.4, 3.2)),
                fbm(p + vec3(2.7, 8.5, 12.3))
              );
            }

            void main() {
                // 归一化的视线方向
                vec3 viewDir = normalize(vWorldPosition);
                vec3 sunDir = normalize(uSunPos);

                // --- 1. 绘制天空背景 (透明背景，方便透视到天空盒) ---
                vec3 skyColor = vec3(0.0);

                // --- 2. 与太阳方向的夹角，用于后续云光照 ---
                float sunDot = dot(viewDir, sunDir);

                // --- 3. 生成云层 ---
                // 主噪声控制体积轮廓，辅以噪声扰动让云更蓬松
                float baseScale = 0.0044;
                vec3 basePos = vWorldPosition * baseScale;
                basePos.x += uTime * 0.012;
                basePos.z -= uTime * 0.01;

                vec3 warp = fbmVec3(basePos * 1.1 + vec3(0.0, uTime * 0.008, 0.0)) * 0.35;
                float shapeNoise = fbm(basePos + warp * 1.0);
                shapeNoise = shapeNoise * 0.5 + 0.5;

                vec3 detailPos = vWorldPosition * 0.0095 + warp * 1.65;
                detailPos.x += uTime * 0.024;
                detailPos.z += uTime * 0.02;
                float detailNoise = fbm(detailPos * 1.8);
                detailNoise = detailNoise * 0.5 + 0.5;

                // --- 云层形状控制 ---
                float horizonFade = smoothstep(0.0, 0.42, viewDir.y);

                float primary = smoothstep(0.46, 0.76, shapeNoise);
                float fluff = smoothstep(0.38, 0.88, detailNoise);
                float cloudAlpha = primary * mix(0.5, 1.0, fluff);

                // 竖直方向分层：不同高度的云具有不同密度
                float heightNorm = clamp((vWorldPosition.y + 200.0) / 1100.0, 0.0, 1.0);
                float layerLow = smoothstep(0.05, 0.3, heightNorm) * (1.0 - smoothstep(0.38, 0.5, heightNorm));
                float layerMid = smoothstep(0.28, 0.6, heightNorm) * (1.0 - smoothstep(0.65, 0.8, heightNorm));
                float layerHigh = smoothstep(0.55, 0.92, heightNorm);

                float heightVariation = fbm(vec3(basePos.xz * 2.4, heightNorm * 3.3));
                heightVariation = heightVariation * 0.5 + 0.5;

                float layerMask = layerLow * 0.85 + layerMid + layerHigh * 0.65;
                float heightMod = clamp(layerMask * mix(0.65, 1.25, heightVariation), 0.0, 1.0);

                cloudAlpha *= heightMod * horizonFade * 1.08;
                cloudAlpha = pow(cloudAlpha, 1.05);

                // --- 云层颜色与光照 ---
                vec3 cloudBaseColor = vec3(1.0);
                vec3 cloudShadowColor = vec3(0.93, 0.95, 0.99);

                // 太阳高度用于调节整体光照颜色
                float sunAltitude = clamp(sunDir.y * 0.5 + 0.5, 0.0, 1.0);
                vec3 sunLightColor = mix(vec3(1.0, 0.82, 0.7), vec3(1.0), sunAltitude);
                vec3 ambientSkyColor = mix(vec3(0.82, 0.88, 0.95), vec3(0.95, 0.97, 1.0), sunAltitude);

                float lightIntensity = clamp(sunDot * 0.35 + 0.68, 0.55, 1.0);
                vec3 directLighting = mix(cloudShadowColor, cloudBaseColor, lightIntensity) * sunLightColor;

                float forwardScattering = pow(max(sunDot, 0.0), 8.0);
                float backScattering = pow(max(-sunDot, 0.0), 3.0) * 0.25;
                float anisotropic = forwardScattering * 1.6 + backScattering;

                float ambientLift = mix(0.32, 0.12, cloudAlpha);
                vec3 ambientLighting = ambientSkyColor * ambientLift;

                vec3 finalCloudColor = directLighting + ambientLighting;
                finalCloudColor += sunLightColor * anisotropic;

                float silverLining = smoothstep(0.7, 1.0, sunDot) * (1.0 - cloudAlpha);
                finalCloudColor += sunLightColor * silverLining * 1.1;

                float edgeBrighten = smoothstep(0.05, 0.35, cloudAlpha);
                finalCloudColor = mix(vec3(1.0), finalCloudColor, edgeBrighten * 0.55 + 0.3);
                float softnessWhiten = mix(0.58, 0.2, cloudAlpha);
                finalCloudColor = mix(finalCloudColor, vec3(1.0), softnessWhiten);
                finalCloudColor += (1.0 - fluff) * 0.1;
                vec3 heightTint = mix(vec3(0.97, 0.98, 1.02), vec3(1.0, 1.0, 0.96), heightNorm);
                finalCloudColor *= heightTint;
                finalCloudColor += vec3(0.05) * heightNorm;
                finalCloudColor = clamp(finalCloudColor, 0.0, 1.0);

                // --- 最终混合 ---
                vec3 finalColor = finalCloudColor;

                gl_FragColor = vec4(finalColor, cloudAlpha);
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
