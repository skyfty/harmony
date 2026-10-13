import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'

/**
 * slowroads 降雪（官方实现逐段移植）。
 *
 * 一个跟随相机前向 15m 的 30×30×30 盒子（220 网格 → 满格 221² 点，稀疏版每 3
 * 格取 1），顶点按 `mod(y - time*speed, boxHeight)` 循环下落 + 噪声风偏，`minDist`
 * 内的点丢弃（避免糊脸）；片元颜色 = snowCol + 车灯亮度（编辑器无车灯 → 恒为底色）。
 */

const VERTEX_PARS = /* glsl */ `
    uniform float time;
    uniform sampler2D noiseMap;
    uniform vec3 offset;
    uniform float boxWidth;
    uniform float boxHeight;
    uniform float minDist;
    uniform float speed;

    varying float vBrightness;
    varying float skip;
`

const PROJECT_VERTEX = /* glsl */ `
    vec4 wPos = modelMatrix * vec4( position, 1.0 );

    vec2 wuv = vec2(
      transformed.x/50. + time/200.,
      transformed.z/50. + time/200.
    );

    float noise = texture2D(noiseMap, wuv).r;

    transformed.y = mod(mod(transformed.y - offset.y, boxWidth) - time * speed, boxHeight);
    transformed.x = mod(transformed.x - offset.x, boxWidth);
    transformed.z = mod(transformed.z - offset.z, boxWidth);

    transformed.x += noise * 2.;
    transformed.z += cos(noise);

    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING

        mvPosition = instanceMatrix * mvPosition;

    #endif

    mvPosition = modelViewMatrix * mvPosition;

    gl_Position = projectionMatrix * mvPosition;

    skip = 0.0;
    if(-mvPosition.z < minDist) {
      skip = 1.0;
    }

    vBrightness = 0.0;
`

const POINT_SIZE = /* glsl */ `
    gl_PointSize = 0.045 * scale / max(0.0001, -mvPosition.z);
`

const FRAGMENT_PARS = /* glsl */ `
    uniform vec3 snowCol;
    varying float vBrightness;
    varying float skip;
`

const FRAGMENT_BODY = /* glsl */ `
    if(skip > 0.5) {
        discard;
    }
    diffuseColor.rgb = snowCol + vec3(vBrightness);
`

export interface SlowroadsSnowHandle {
  container: THREE.Group
  /** null 或 density=0 = 隐藏。 */
  setConfig(config: EnvironmentPreset['snow'] | null): void
  /** 资产热切换（赛季资产加载完成 / 来源切换）。 */
  setNoiseTexture(texture: THREE.Texture): void
  update(elapsedSeconds: number, cameraWorldPosition: THREE.Vector3, cameraForward: THREE.Vector3): void
  dispose(): void
}

const SNOW_GRID = 220
const SNOW_BOX = 30
const SNOW_BOX_HALF = SNOW_BOX / 2

function buildGeometry(step: number): THREE.BufferGeometry {
  const positions: number[] = []
  for (let d = 0; d <= SNOW_GRID; d += 1) {
    for (let m = 0; m <= SNOW_GRID; m += 1) {
      if (d % step !== 0 || m % step !== 0) {
        continue
      }
      positions.push(
        (d / SNOW_GRID) * SNOW_BOX,
        Math.random() * SNOW_BOX,
        (m / SNOW_GRID) * SNOW_BOX,
      )
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  return geometry
}

export function createSlowroadsSnow(noiseTexture: THREE.Texture | null): SlowroadsSnowHandle {
  const fullGeometry = buildGeometry(1)
  const halfGeometry = buildGeometry(3)

  const uniforms = {
    time: { value: 0 },
    speed: { value: 1.25 },
    noiseMap: { value: noiseTexture },
    offset: { value: new THREE.Vector3() },
    boxWidth: { value: SNOW_BOX },
    boxHeight: { value: SNOW_BOX },
    minDist: { value: 0.3 },
    snowCol: { value: new THREE.Color(0xffffff) },
  }
  const material = new THREE.PointsMaterial({
    size: 1,
    map: null,
    alphaTest: 0.1,
    forceSinglePass: true,
    fog: false,
  })
  material.customProgramCacheKey = () => 'sr-snow-v1'
  material.name = 'slowroads-snow-material'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = uniforms.time
    shader.uniforms.speed = uniforms.speed
    shader.uniforms.noiseMap = uniforms.noiseMap
    shader.uniforms.offset = uniforms.offset
    shader.uniforms.boxWidth = uniforms.boxWidth
    shader.uniforms.boxHeight = uniforms.boxHeight
    shader.uniforms.minDist = uniforms.minDist
    shader.uniforms.snowCol = uniforms.snowCol
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', PROJECT_VERTEX)
      .replace('#include <logdepthbuf_vertex>', `${POINT_SIZE}\n#include <logdepthbuf_vertex>`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAGMENT_PARS}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n${FRAGMENT_BODY}`)
  }

  const points = new THREE.Points(halfGeometry, material)
  points.position.x -= SNOW_BOX_HALF
  points.position.y -= SNOW_BOX_HALF
  points.position.z -= SNOW_BOX_HALF
  points.frustumCulled = false
  points.visible = false
  points.name = 'slowroads-snow-points'

  const container = new THREE.Group()
  container.name = 'slowroads-snow'
  container.add(points)

  const forwardScratch = new THREE.Vector3()

  return {
    container,
    setConfig(config: EnvironmentPreset['snow'] | null): void {
      if (!config || config.density <= 0) {
        points.visible = false
        return
      }
      points.visible = true
      points.geometry = config.density <= 0.5 ? halfGeometry : fullGeometry
      uniforms.speed.value = config.speed
      uniforms.snowCol.value.set(config.col)
    },
    setNoiseTexture(texture: THREE.Texture): void {
      uniforms.noiseMap.value = texture
    },
    update(elapsedSeconds: number, cameraWorldPosition: THREE.Vector3, cameraForward: THREE.Vector3): void {
      if (!points.visible) {
        return
      }
      forwardScratch.set(cameraForward.x, 0, cameraForward.z)
      if (forwardScratch.lengthSq() < 1e-8) {
        forwardScratch.set(0, 0, -1)
      }
      forwardScratch.normalize()
      container.position
        .copy(cameraWorldPosition)
        .addScaledVector(forwardScratch, SNOW_BOX_HALF)
      uniforms.time.value = elapsedSeconds
      uniforms.offset.value.copy(container.position)
    },
    dispose(): void {
      container.removeFromParent()
      fullGeometry.dispose()
      halfGeometry.dispose()
      material.dispose()
    },
  }
}
