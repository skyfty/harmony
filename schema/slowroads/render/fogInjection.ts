import * as THREE from 'three'
import type { ResolvedFogParams } from '../core/environment'

/**
 * Slow Roads 三色高度雾（官方 fog chunk 的按材质注入版）。
 *
 * 官方直接替换 three 的 `ShaderChunk.fog_*`；编辑器的场景里还有城市生成器、
 * 通用网格等大量材质，全局替换会改变它们的外观，因此这里改成**按材质注入**：
 * 在 `onBeforeCompile` 里把 `#include <fog_pars_vertex|fog_vertex|fog_pars_fragment|
 * fog_fragment>` 替换为官方实现。由于 scene.fog 恒为 null（SR 雾是场景唯一雾），
 * 注入文本不再包 `#ifdef USE_FOG`，并用 `srFogEnabled` 做运行时开关
 * （editor 视口"仅选中 Environment 节点时预览雾"）。
 *
 * 官方语义：圆柱（到相机）雾距、噪声起伏雾顶、正负 haze 层、视线水平方向的
 * A/B 混色与 C 色去饱和。uniform 走模块级共享实例：环境运行时一次写入，
 * 所有绑定过的 SR 材质同时生效。
 */

const FOG_PARS_VERTEX = /* glsl */ `
    varying float vFogDepth;
    varying vec3 vFogPos;
    varying float vFogBlend;
    varying float vHaze;

    uniform float fogNear;
    uniform float fogFar;
    uniform float fogDensity;
    uniform float hazeHeight;
    uniform float hazeIntensity;

float srFogNoise(vec2 p, float freq ) {
    float unit = 1024./freq;
    vec2 ij = floor(p/unit);
    vec2 xy = mod(p,unit)/unit;
    xy = .5*(1.-cos(PI*xy));
    float a = rand((ij+vec2(0.,0.)));
    float b = rand((ij+vec2(1.,0.)));
    float c = rand((ij+vec2(0.,1.)));
    float d = rand((ij+vec2(1.,1.)));
    float x1 = mix(a, b, xy.x);
    float x2 = mix(c, d, xy.x);
    return mix(x1, x2, xy.y);
}

float srFogPNoise(vec2 p, int res) {
    float persistance = .5;
    float n = 0.;
    float normK = 0.;
    float f = 4.;
    float amp = 1.;
    int iCount = 0;
    for (int i = 0; i<50; i++){
        n+=amp*srFogNoise(p, f);
        f*=2.;
        normK+=amp;
        amp*=persistance;
        if (iCount == res) break;
        iCount++;
    }
    float nf = n/normK;
    return nf*nf*nf*nf;
}
`

const FOG_VERTEX = /* glsl */ `
    vFogPos = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef USE_INSTANCING
        vFogPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    #endif

    //// CYLINDRICAL FOG DEPTH
    float srFogDepth = distance(vFogPos, cameraPosition);

    vHaze = srFogDepth / fogFar;
    vHaze *= 1.0 + min(0.0, hazeIntensity);

    vFogDepth = max(0.0, (srFogDepth - fogNear) * (fogFar / max(0.001, fogFar - fogNear)));
    vFogDepth = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

    //// NOISE VARIATION
    float srFogHeight = vFogPos.y;
    if (srFogDepth < 1000.0) {
        srFogHeight += srFogPNoise(vFogPos.xz*2.0, 3) * hazeHeight * (srFogDepth / 1000.0);
    } else {
        srFogHeight += srFogPNoise(vFogPos.xz*2.0, 3) * hazeHeight;
    }

    //// HAZE
    if (hazeHeight > 0.0 && srFogHeight < hazeHeight) {
        float haze = (1.0 - (srFogHeight / hazeHeight)) * hazeIntensity;
        if (srFogDepth < 50.0) {
            float fff = 1.0 - (srFogDepth / 50.0);
            haze *= 1.0 - fff*fff;
        }
        if (haze < 0.0) {
            haze = 0.0;
        }
        vFogDepth += haze;
    } else if (hazeHeight < 0.0 && srFogHeight > -hazeHeight) {
        float haze = min(1.0, (srFogHeight / -hazeHeight) - 1.0) * hazeIntensity;
        if (srFogDepth < 50.0) {
            float fff = 1.0 - (srFogDepth / 50.0);
            haze *= 1.0 - fff*fff;
        }
        vFogDepth += haze;
    }

    float fogAvg = (fogFar + fogNear) / 2.0;
    vFogBlend = 1.0;
    if (fogAvg < 500.0) {
        if (fogAvg < 50.0) {
            vFogBlend = 0.0;
        } else {
            vFogBlend = (fogAvg-50.0) / 450.0;
        }
    }
    if (hazeHeight < 0.0) {
        vFogBlend *= (1.0 - hazeIntensity);
    }

    //// LIMIT
    vFogDepth = min(1.0, vFogDepth);
`

const FOG_PARS_FRAGMENT = /* glsl */ `
    uniform vec3 fogColorA;
    uniform vec3 fogColorB;
    uniform vec3 fogColorC;
    varying float vFogDepth;
    varying vec3 vFogPos;
    varying float vFogBlend;
    varying float vHaze;
    uniform float srFogEnabled;
`

/**
 * 片元雾体（替换 `#include <fog_fragment>`）。官方在 tonemapping/colorspace
 * 之后混合，因此颜色直接以输出空间使用（与官方一致）。
 */
export const SLOWROADS_FOG_FRAGMENT = /* glsl */ `
    float srFogBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend;
    float srFogAmount = clamp(vFogDepth * srFogEnabled, 0.0, 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, clamp(vHaze * srFogEnabled, 0.0, 1.0));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColorA, fogColorB, srFogBlend), srFogAmount);
`

export interface SlowroadsFogUniforms {
  fogColorA: THREE.IUniform<THREE.Color>
  fogColorB: THREE.IUniform<THREE.Color>
  fogColorC: THREE.IUniform<THREE.Color>
  fogNear: THREE.IUniform<number>
  fogFar: THREE.IUniform<number>
  fogDensity: THREE.IUniform<number>
  hazeHeight: THREE.IUniform<number>
  hazeIntensity: THREE.IUniform<number>
  srFogEnabled: THREE.IUniform<number>
}

/**
 * 共享雾 uniform。同一 JS realm 内所有 SR 材质绑定同一组实例；环境运行时
 * 每帧写入一次即可全场景生效。多场景同页并存不受支持（与官方一致）。
 */
export const slowroadsFogUniforms: SlowroadsFogUniforms = {
  fogColorA: { value: new THREE.Color(1, 1, 1) },
  fogColorB: { value: new THREE.Color(1, 1, 1) },
  fogColorC: { value: new THREE.Color(1, 1, 1) },
  fogNear: { value: 0 },
  fogFar: { value: 1000 },
  fogDensity: { value: 0.002 },
  hazeHeight: { value: 0 },
  hazeIntensity: { value: 0 },
  srFogEnabled: { value: 0 },
}

/** 把共享实例绑定到某个材质的 uniforms（内置材质在 onBeforeCompile 里调用）。 */
export function bindSlowroadsFogUniforms(uniforms: Record<string, THREE.IUniform>): void {
  for (const [key, uniform] of Object.entries(slowroadsFogUniforms)) {
    uniforms[key] = uniform as THREE.IUniform
  }
}

export function setSlowroadsFogParams(
  params: ResolvedFogParams,
  colors: { colA: THREE.Color; colB: THREE.Color; colC: THREE.Color },
): void {
  slowroadsFogUniforms.fogNear.value = params.near
  slowroadsFogUniforms.fogFar.value = params.far
  slowroadsFogUniforms.fogDensity.value = params.density
  slowroadsFogUniforms.hazeHeight.value = params.hazeHeight
  slowroadsFogUniforms.hazeIntensity.value = params.hazeIntensity
  slowroadsFogUniforms.fogColorA.value.copy(colors.colA)
  slowroadsFogUniforms.fogColorB.value.copy(colors.colB)
  slowroadsFogUniforms.fogColorC.value.copy(colors.colC)
}

export function setSlowroadsFogEnabled(enabled: boolean): void {
  slowroadsFogUniforms.srFogEnabled.value = enabled ? 1 : 0
}

interface PatchedShader {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

/**
 * 顶点侧注入：替换 fog_pars_vertex / fog_vertex 两个 include。
 * `requireIncludes` 为 true 时返回是否全部命中（用于自检/测试）。
 */
export function injectSlowroadsFogVertex(shader: PatchedShader): boolean {
  let ok = true
  bindSlowroadsFogUniforms(shader.uniforms)
  if (shader.vertexShader.includes('#include <fog_pars_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX)
  } else {
    ok = false
  }
  if (shader.vertexShader.includes('#include <fog_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', FOG_VERTEX)
  } else {
    ok = false
  }
  return ok
}

/** 片元侧注入：替换 fog_pars_fragment / fog_fragment 两个 include。 */
export function injectSlowroadsFogFragment(shader: PatchedShader): boolean {
  let ok = true
  bindSlowroadsFogUniforms(shader.uniforms)
  if (shader.fragmentShader.includes('#include <fog_pars_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
  } else {
    ok = false
  }
  if (shader.fragmentShader.includes('#include <fog_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', SLOWROADS_FOG_FRAGMENT)
  } else {
    ok = false
  }
  return ok
}

export function injectSlowroadsFog(shader: PatchedShader): boolean {
  const vertexOk = injectSlowroadsFogVertex(shader)
  const fragmentOk = injectSlowroadsFogFragment(shader)
  return vertexOk && fragmentOk
}

/** 供自检/测试使用：确认当前注入文本包含关键记号。 */
export function slowroadsFogInjectionSource(): {
  vertexPars: string
  vertexBody: string
  fragmentPars: string
  fragmentBody: string
} {
  return {
    vertexPars: FOG_PARS_VERTEX,
    vertexBody: FOG_VERTEX,
    fragmentPars: FOG_PARS_FRAGMENT,
    fragmentBody: SLOWROADS_FOG_FRAGMENT,
  }
}

/** 官方 updateAlways 里的 haze 高度插值（相机进入/离开雾层时拉近雾）。 */
export interface SlowroadsHazeState {
  inHaze: boolean
}

export function resolveHazeForCamera(
  base: ResolvedFogParams,
  cameraY: number,
  state: SlowroadsHazeState,
): ResolvedFogParams {
  const hazeHeight = base.hazeHeight
  const hazeIntensity = base.hazeIntensity
  if (hazeHeight > 0 && cameraY < hazeHeight) {
    let e = 1 - cameraY / hazeHeight
    e *= e
    state.inHaze = true
    const near = base.near * (1 - e * hazeIntensity)
    const far = base.far * (1 - e * Math.min(0.9, hazeIntensity))
    return {
      near,
      far,
      density: Math.sqrt(5 / (far * far)),
      hazeHeight: hazeHeight * (1 + 3 * e),
      hazeIntensity,
    }
  }
  if (hazeHeight < 0 && cameraY > -hazeHeight) {
    let e = cameraY / -hazeHeight - 1
    if (e > 1) {
      e = 1
    }
    e *= e
    state.inHaze = true
    let nextHazeHeight = hazeHeight * (1 - e * hazeIntensity)
    if (nextHazeHeight >= 0) {
      nextHazeHeight = -1
    }
    const near = base.near * (1 - e)
    const far = base.far * (1 - e * 0.9)
    return {
      near,
      far,
      density: Math.sqrt(5 / (far * far)),
      hazeHeight: nextHazeHeight,
      hazeIntensity,
    }
  }
  state.inHaze = false
  return base
}
