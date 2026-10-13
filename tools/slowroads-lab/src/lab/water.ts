import * as THREE from 'three'

/**
 * 水线平面：sea_waves 做双方向滚动波纹 + 菲涅尔天空色 + 太阳高光。
 * 参与雾，这样远岸会自然融进天色；水线以下的地形照旧由地表材质渲染。
 */
export interface WaterOptions {
  worldSize: number
  waterLevel: number
  waves: THREE.Texture
  skyColor: THREE.ColorRepresentation
  sunDir: THREE.Vector3
  sunColor: THREE.Color
}

export interface WaterHandle {
  mesh: THREE.Mesh
  setTime(seconds: number): void
  /** 冬季冻结外观（slowroads 的 frozenWater 效果）。 */
  setFrozen(frozen: boolean): void
  /** 按环境预设更新水色与菲涅尔强度（slowroads water.body/highlight/fresnelFactor）。 */
  setEnvironment(params: { body: string; highlight: string; fresnelFactor: number }): void
  dispose(): void
}

const VERTEX_SHADER = `
#include <common>
varying vec3 vWorldPosition;
varying float vViewDistance;
#include <fog_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uWaves;
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uDeepColor;
uniform vec3 uHighlight;
uniform float uFresnelScale;
uniform float uFrozen;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vWorldPosition;
varying float vViewDistance;
#include <fog_pars_fragment>
void main() {
  vec2 worldUv = vWorldPosition.xz;
  vec2 uvA = worldUv / 64.0 + vec2(uTime * 0.0055, uTime * 0.0042);
  vec2 uvB = worldUv / 27.0 - vec2(uTime * 0.0091, uTime * 0.0026);
  float waveA = texture2D(uWaves, uvA).r;
  float waveB = texture2D(uWaves, uvB).r;
  float wave = waveA * 0.65 + waveB * 0.35;
  float dx = texture2D(uWaves, uvA + vec2(0.03, 0.0)).r - waveA;
  float dz = texture2D(uWaves, uvA + vec2(0.0, 0.03)).r - waveA;
  vec3 rippleNormal = normalize(vec3(-dx * 1.4, 1.0, -dz * 1.4));
  // 远处水面收敛回平面，避免远景闪烁的镜面噪声。
  float rippleFade = 1.0 - smoothstep(120.0, 520.0, vViewDistance);
  rippleFade *= 1.0 - uFrozen;
  vec3 normal = normalize(mix(vec3(0.0, 1.0, 0.0), rippleNormal, rippleFade));

  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  vec3 color = mix(uDeepColor, uSkyColor, clamp(0.28 + 0.72 * clamp(fresnel * uFresnelScale, 0.0, 1.0), 0.0, 1.0));
  // 冬季：冻结的灰白冰面，收敛波纹与高光。
  color = mix(color, mix(vec3(0.80, 0.84, 0.87), uSkyColor, 0.35), uFrozen * 0.85);
  vec3 halfDir = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
  color += uHighlight * spec * 1.1 * rippleFade;
  color += vec3(wave - 0.5) * 0.045 * rippleFade;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function createWater(options: WaterOptions): WaterHandle {
  const geometry = new THREE.PlaneGeometry(options.worldSize, options.worldSize, 1, 1)
  const waves = options.waves
  waves.wrapS = THREE.RepeatWrapping
  waves.wrapT = THREE.RepeatWrapping

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uWaves: { value: waves },
      uTime: { value: 0 },
      uSkyColor: { value: new THREE.Color(options.skyColor) },
      uDeepColor: { value: new THREE.Color(0x1d3b46) },
      uHighlight: { value: options.sunColor.clone() },
      uFresnelScale: { value: 1 },
      uFrozen: { value: 0 },
      uSunDir: { value: options.sunDir.clone() },
      uSunColor: { value: options.sunColor.clone() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
  })
  material.name = 'slowroads-water-material'

  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = options.waterLevel
  mesh.name = 'slowroads-water'
  mesh.receiveShadow = false
  mesh.castShadow = false

  return {
    mesh,
    setTime(seconds: number): void {
      material.uniforms.uTime!.value = seconds
    },
    setFrozen(frozen: boolean): void {
      material.uniforms.uFrozen!.value = frozen ? 1 : 0
    },
    setEnvironment(params: { body: string; highlight: string; fresnelFactor: number }): void {
      ;(material.uniforms.uDeepColor!.value as THREE.Color).set(params.body)
      ;(material.uniforms.uHighlight!.value as THREE.Color).set(params.highlight)
      material.uniforms.uFresnelScale!.value = params.fresnelFactor
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
