import * as THREE from 'three'
import type { EnvironmentPreset } from '../core/environment'
import { bindSlowroadsFogUniforms } from './fogPatch'

/**
 * slowroads 云层（官方 shader 逐段移植）。
 *
 * 一块 1×1×20段 的平面绕 X 轴旋转 90°放平，整体放大到 `max(2×视距, 云高×12)`；
 * 顶点着色器把两个"云棚"（shelfHeight0/1）投影成两层视差 UV（vUUv/vUUUv）+ 一个
 * 偏移副本（vUUUUv，用于阴影/边缘），并生成 `dist`（圆形遮罩）；片元按 `mode`
 * 选择混合规则（0/1/2/3 有实现，4/5 官方为空实现 = 不绘制），颜色在
 * highlight/lowlight 之间过渡。雾由官方 3 色 fog chunk 提供；片元里复用了
 * fog chunk 的局部变量 `fogBlend`（与官方结构一致）。
 */

const UV_PARS_VERTEX = /* glsl */ `
    uniform float time;
    uniform vec3 camPos;
    uniform float shelfHeight0;
    uniform float shelfHeight1;
    uniform float skyScale0;
    uniform float skyScale1;
    uniform float altitude;

    varying vec4 wPos;
    varying vec2 vUv;
    varying vec2 vUUv;
    varying vec2 vUUUv;
    varying vec2 vUUUUv;

    varying float dist;
`

const UV_VERTEX = /* glsl */ `
    wPos = modelMatrix * vec4( position, 1.0 );

    // Distance (height) from camera to virtual plane
    float h0 = shelfHeight0 - camPos.y;

    // Distance from camera to image plane
    float h1 = shelfHeight1 - camPos.y;

    vUv = uv;

    // First shelf...
    vUUv.x = wPos.x + time;
    vUUv.y = wPos.z + time;
    vUUv /= skyScale0 * altitude;

    float scale1 = skyScale1 * altitude;
    float lowerScale = scale1 * h1 / h0;
    float motionScale = (h1 - h0) / h0;

    // Second shelf
    vUUUv.x = ((wPos.x + camPos.x * motionScale ) / lowerScale) + time / scale1;
    vUUUv.y = ((wPos.z + camPos.z * motionScale ) / lowerScale) + time / scale1;

    // Offset copy of second shelf used for shading?
    vUUUUv.x = vUUUv.x + 0.001;
    vUUUUv.y = vUUUv.y - 0.001;

    // Use UVs to look up distance from camera...
    float vX = (uv.x - 0.5) * 2.0;
    float vY = (uv.y - 0.5) * 2.0;
    dist = max(0.0, 1.0 - sqrt((vX * vX) + (vY * vY)));
`

const PROJECT_VERTEX = /* glsl */ `
    transformed.z += (1.0 - dist)*(1.0 - dist) * altitude;

    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING

        mvPosition = instanceMatrix * mvPosition;

    #endif

    mvPosition = modelViewMatrix * mvPosition;

    gl_Position = projectionMatrix * mvPosition;
`

/** 云层的雾：与地表同一套参数，但雾距直接取 fogFar（云在无穷远/棚顶）。 */
const FOG_PARS_VERTEX_CLOUDS = /* glsl */ `
    #ifdef USE_FOG

        varying float vFogDepth;
        varying vec3 vFogPos;
        varying float vFogBlend;
        varying float vHaze;

        uniform float fogNear;
        uniform float fogFar;

        #ifdef FOG_EXP2
            uniform float fogDensity;
        #endif

        uniform float hazeHeight;
        uniform float hazeIntensity;

    #endif
`

const FOG_VERTEX_CLOUDS = /* glsl */ `
    #ifdef USE_FOG

        vFogDepth = fogFar;

        vFogPos = (modelMatrix * vec4(transformed, 1.0)).xyz;

        vHaze = 0.0;

        vFogBlend = 1.0;
        float fogAvg = (fogFar + fogNear) / 2.0;
        if(fogAvg < 500.0) {
            if(fogAvg <  50.0) {
                vFogBlend = 0.0;
            } else {
                vFogBlend = (fogAvg-50.0) / 450.0;
            }
        }
        if(hazeHeight < 0.0) {
            vFogBlend *= (1.0 - hazeIntensity);
        }

        #ifdef FOG_EXP2
            vFogDepth = max(0.0, (vFogDepth - fogNear) * (fogFar / (fogFar - fogNear)));
        #endif

        #ifdef FOG_EXP2

            vFogDepth = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

        #else

            vFogDepth = smoothstep( fogNear, fogFar, vFogDepth );

        #endif

    #endif
`

const UV_PARS_FRAGMENT = /* glsl */ `
    uniform vec3 highlight;
    uniform vec3 lowlight;
    uniform float mode;

    varying vec2 vUv;
    varying vec2 vUUv;
    varying vec2 vUUUv;
    varying vec2 vUUUUv;
    varying float dist;

    highp float random(vec2 coords) {
        return (fract(sin(dot(coords.xy, vec2(12.9898,78.233))) * 43758.5453) * 0.2) - 0.1;
    }

    float remap(float value, float min1, float max1, float min2, float max2) {
        return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
    }
`

const FOG_FRAGMENT_CLOUDS = /* glsl */ `
    vec4 c1 = texture2D(map, vUUv);
    vec4 c2 = texture2D(map, vUUUv);

    vec4 cloudCol = c1;

    //////////////////////////// BLEND MODES ///////////////////////////

    if(mode == 0.0) {

        vec4 c3 = texture2D(map, vUUUUv);

        float ic1 = 1.0 - c1.a;
        float ic2 = 1.0 - c2.a;
        float ic = 1.0 - ic1 * ic2;

        ic *= c3.a;

        cloudCol = vec4(lowlight, ic);

        cloudCol.rgb = mix(cloudCol.rgb, highlight, c3.a * ic);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol.rgb, cloudCol.a * min(1.0,fogBlend)*dist);

    } else if(mode == 1.0)  {

        vec4 c3 = texture2D(map, vUUUUv);

        cloudCol.rgb = lowlight;

        // Screen alpha
        cloudCol.a = 1.0 - (1.0 - c1.a) * (1.0 - c2.a);

        cloudCol.rgb = mix(lowlight, highlight,  c1.a * cloudCol.a * c3.a);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol.rgb, cloudCol.a * dist * dist);

    } else if(mode == 2.0) {
        vec4 c3 = texture2D(map, vUUUUv);

        // Two-tone

        c1.a = remap(c1.a, 0.0, 1.0, 0.0, 1.0);
        c2.a = remap(c2.a, 0.0, 1.0, 0.25, 1.0);
        c3.a = remap(c3.a, 0.0, 1.0, 0.0, 0.5);

        c2.a *= c1.a;
        c3.a *= c1.a;

        cloudCol.rgb = lowlight;

        // Screen blend the initial alpha
        float ic1 = 1.0 - c1.a;
        float ic2 = 1.0 - c2.a;
        cloudCol.a = 1.0 - (ic1 * ic2);

        cloudCol.rgb = mix(cloudCol.rgb, highlight*1.5, c3.a * (dist * 2.0)); // More pink above

        gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol.rgb, cloudCol.a * min(1.0,fogBlend)*dist);

    } else if(mode == 3.0) {

        vec4 c3 = texture2D(map, vUUUUv);

        float c23 = 1.0 - (1.0 - c3.a) * (1.0 - c2.a);

        cloudCol.rgb = mix(lowlight, highlight, min(c2.a, c3.a));

        cloudCol.a = max(c2.a, c1.a * c3.a);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol.rgb, cloudCol.a * dist * dist);
    }
`

export interface CloudsHandle {
  mesh: THREE.Mesh
  setState(clouds: EnvironmentPreset['clouds'], altitude: number, viewDistance: number): void
  /** 资产热切换（兼容模式/来源切换会重建纹理）。 */
  setTexture(texture: THREE.Texture): void
  update(deltaSeconds: number, cameraWorldPosition: THREE.Vector3): void
  setVisible(visible: boolean): void
  dispose(): void
}

export function createClouds(texture: THREE.Texture): CloudsHandle {
  const geometry = new THREE.PlaneGeometry(1, 1, 20, 20)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    fog: true,
    depthTest: false,
    side: THREE.DoubleSide,
  })
  const uniforms = {
    highlight: { value: new THREE.Color(0xffffff) },
    lowlight: { value: new THREE.Color(0xeeeeee) },
    hasClouds: { value: true },
    camPos: { value: new THREE.Vector3() },
    time: { value: 0 },
    shelfHeight0: { value: 1000 },
    shelfHeight1: { value: 1200 },
    skyScale0: { value: 6000 },
    skyScale1: { value: 3000 },
    mode: { value: 0 },
    altitude: { value: 300 },
  }
  material.customProgramCacheKey = () => 'clouds'
  material.name = 'slowroads-clouds-material'
  material.onBeforeCompile = (shader) => {
    bindSlowroadsFogUniforms(shader.uniforms)
    shader.uniforms.highlight = uniforms.highlight
    shader.uniforms.lowlight = uniforms.lowlight
    shader.uniforms.hasClouds = uniforms.hasClouds
    shader.uniforms.camPos = uniforms.camPos
    shader.uniforms.time = uniforms.time
    shader.uniforms.shelfHeight0 = uniforms.shelfHeight0
    shader.uniforms.shelfHeight1 = uniforms.shelfHeight1
    shader.uniforms.skyScale0 = uniforms.skyScale0
    shader.uniforms.skyScale1 = uniforms.skyScale1
    shader.uniforms.mode = uniforms.mode
    shader.uniforms.altitude = uniforms.altitude
    shader.vertexShader = shader.vertexShader.replace('#include <uv_pars_vertex>', `#include <uv_pars_vertex>\n${UV_PARS_VERTEX}`)
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n${UV_VERTEX}`)
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX_CLOUDS)
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', FOG_VERTEX_CLOUDS)
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', PROJECT_VERTEX)
    shader.fragmentShader = shader.fragmentShader.replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>\n${UV_PARS_FRAGMENT}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>\n${FOG_FRAGMENT_CLOUDS}`)
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-clouds'
  mesh.rotation.x = Math.PI / 2
  mesh.renderOrder = -9
  mesh.frustumCulled = false

  let enabled = true
  let hasClouds = true
  let viewDistance = 1000
  let cloudAltitude = 300

  const applyScale = (): void => {
    const scale = Math.max(viewDistance * 2, cloudAltitude * 12)
    mesh.scale.set(scale, scale, 1)
  }
  applyScale()

  return {
    mesh,
    setState(clouds, altitude, nextViewDistance): void {
      hasClouds = clouds.hasClouds
      viewDistance = nextViewDistance
      cloudAltitude = altitude
      applyScale()
      uniforms.highlight.value.set(clouds.highlight)
      uniforms.lowlight.value.set(clouds.lowlight)
      uniforms.shelfHeight0.value = clouds.shelfHeight0
      uniforms.shelfHeight1.value = clouds.shelfHeight1
      uniforms.skyScale0.value = clouds.skyScale0
      uniforms.skyScale1.value = clouds.skyScale1
      uniforms.mode.value = clouds.mode
      uniforms.altitude.value = altitude
      mesh.visible = enabled && hasClouds
    },
    setTexture(next: THREE.Texture): void {
      next.wrapS = THREE.RepeatWrapping
      next.wrapT = THREE.RepeatWrapping
      material.map = next
      material.needsUpdate = true
    },
    update(deltaSeconds: number, cameraWorldPosition: THREE.Vector3): void {
      // 官方 Hills：云平面跟随相机水平位置、固定在世界高度云高（300m），时间 ×2 滚动。
      mesh.position.set(cameraWorldPosition.x, cloudAltitude, cameraWorldPosition.z)
      uniforms.time.value += deltaSeconds * 2
      uniforms.camPos.value.copy(cameraWorldPosition)
    },
    setVisible(visible: boolean): void {
      enabled = visible
      mesh.visible = enabled && hasClouds
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
