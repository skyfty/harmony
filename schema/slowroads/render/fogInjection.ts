import * as THREE from 'three'
import type { ResolvedFogParams } from '../core/environment'

/**
 * Slow Roads 三色高度雾（官方 fog chunk 的按材质注入版）。
 *
 * 官方直接替换 three 的 `ShaderChunk.fog_*`；编辑器的场景里还有城市生成器、
 * 通用网格等大量材质，全局替换会改变它们的外观，因此这里改成**按材质注入**：
 * 在 `onBeforeCompile` 里把 `#include <fog_pars_vertex|fog_vertex|fog_pars_fragment|
 * fog_fragment>` 替换为官方实现（scene.fog 恒为 null，SR 雾是场景唯一雾）。
 *
 * 官方语义：圆柱（到相机）雾距、噪声起伏雾顶、正负 haze 层、视线水平方向的
 * A/B 混色与 C 色去饱和。uniform 走模块级共享实例：环境运行时一次写入，
 * 所有绑定过的 SR 材质同时生效。
 *
 * 两组共享 uniform（第五批）：
 *  - `slowroadsFogUniforms`「场景组」：地形 / 植被 / 道路 / 水面 / 降雪（1000 尺度）；
 *  - `slowroadsSkyFogUniforms`「天空组」：天空 / 云层 / 星空（官方 `n1 = tileSize × 2`
 *    = 2000 尺度）。`preset.fog.near < 0` 的预设（春·晨·晴 等 8 套）在 1000 尺度下
 *    `fogAvg = (far+near)/2` 会掉到 500 以下 → vFogBlend = 0.722（官方 1.0），天空
 *    A/B 混色与云层覆盖权重 `min(1,fogBlend)` 都被压低（春·晨·晴实测天空偏粉缺蓝）。
 *
 * 色彩空间（官方 `refreshFogUniforms` 等价物）：雾 chunk 排在
 * `tonemapping_fragment → colorspace_fragment` 之后，混色发生在**当前渲染目标的
 * 输出色空间**。渲染到画布时是 `renderer.outputColorSpace`（sRGB），渲染到
 * 后处理 render target 时是工作色空间（线性）——与官方 `Bs(i)` / three 的
 * `WebGLPrograms` 判据一致，见 `resolveFogUniformColorSpace()`。
 *
 * 编辑器视口例外：`SceneViewport` 经 EffectComposer（RenderPass → … → OutputPass）
 * 出图，场景 pass 渲染到 render target（线性、无色调映射），Cineon 色调映射与
 * sRGB 编码被推迟到最后的 OutputPass。
 *
 * 历史实现按端点做「反 Cineon 预补偿」并在线性域混色——那只在 `w = 0 / 1` 两个
 * 端点成立：`mix()` 与非线性色调映射不可交换，blend>1 的外推（天空平面 A/B 系数
 * 是 `2·sinθ`，仰角 > 30° 即 > 1）在线性域再过 Cineon 会把 R/G 压到 0，春·昼·晴
 * 天顶偏成异常深蓝、冬·昼·阴整片发黑。且 three r186 的 `CineonToneMapping` 还带
 * 一层 `pow(..., 2.2)`（见 `tonemapping_pars_fragment`），只反核心曲线连端点也
 * 还原不了。
 *
 * 现在编辑器改为「显示空间等价」注入（`setSlowroadsFogDisplaySpaceMode(true)`，
 * 由环境运行时的 `deferredToneMapping` 开关启用）：片元体先把材质基色按官方顺序
 * 换算到显示空间（`sRGB(Cineon(x · exposure))`），用**与官方逐字相同**的公式混色
 * （vHaze → A/B 渐变，含 >1 外推），最后用 `srFogDisplayToTargetLinear()` 换回
 * 渲染 target 的线性域，让 OutputPass 的 `sRGB∘Cineon` 精确还原显示色。uniform
 * 因此与 lab 一样直接下发 sRGB 显示分量（`writeFogUniformColors(..., SRGBColorSpace)`）。
 * preview / viewer 直出画布：与 lab 一样走输出色空间分量 + 原始片元体。
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
`

/** 天空平面的顶点雾声明：多一个 `skyDepthCorrection`（见 `FOG_VERTEX_SKY`）。 */
const FOG_PARS_VERTEX_SKY = /* glsl */ `
    varying float vFogDepth;
    varying vec3 vFogPos;
    varying float vFogBlend;
    varying float vHaze;

    uniform float fogNear;
    uniform float fogFar;
    uniform float fogDensity;
    uniform float hazeHeight;
    uniform float hazeIntensity;
    /** 官方天空距离 / 实际平面距离（相机远裁剪面压近天空平面时的等效换算）。 */
    uniform float skyDepthCorrection;

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

/**
 * 天空平面的顶点雾体。
 *
 * 天空平面按官方 n1 距离（2000 × 视距倍率）挂在相机上；但编辑器视口的相机远裁剪面
 * 固定（5000），雾尺度自适应把 n1 放大到远超远裁剪面时整个平面会被裁掉 —— 地平线
 * 处只剩渲染器背景色（"场景边缘一圈灰色"）。
 *
 * 因此天空平面允许被"压近"到远裁剪面以内，并用 `skyDepthCorrection
 * = 官方距离 / 实际距离` 把顶点换算回**官方距离处的等效位置**：
 * vFogDepth / vHaze / haze 层插值与官方逐项一致；A/B 混色只依赖视线仰角
 * （`(vFogPos.y - cameraPosition.y) * 2 / distance` 对任意距离都是 2·sinθ），与平面
 * 远近无关。天空平面是纯雾色背景，除此之外没有别的尺度敏感量。
 */
const FOG_VERTEX_SKY = /* glsl */ `
    vFogPos = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef USE_INSTANCING
        vFogPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    #endif

    vec3 srFogPosAtOfficial = cameraPosition + (vFogPos - cameraPosition) * skyDepthCorrection;
    float srFogDepth = distance(srFogPosAtOfficial, cameraPosition);

    vHaze = srFogDepth / fogFar;
    vHaze *= 1.0 + min(0.0, hazeIntensity);

    vFogDepth = max(0.0, (srFogDepth - fogNear) * (fogFar / max(0.001, fogFar - fogNear)));
    vFogDepth = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

    //// NOISE VARIATION
    float srFogHeight = srFogPosAtOfficial.y;
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

/**
 * 片元雾体（替换 `#include <fog_fragment>`）。官方在 tonemapping/colorspace
 * 之后混合，因此颜色直接以当前渲染目标的输出空间使用（与官方一致）。
 *
 * 注意：官方云层片元复用这里的局部变量 `fogBlend`（在 main 作用域内），
 * 移植时保持同样的结构，不要在它外面再包函数。
 */
export const SLOWROADS_FOG_FRAGMENT = /* glsl */ `
    float fogBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColorA, fogColorB, fogBlend), vFogDepth);
`

/**
 * 天空/云层/星空专用雾体：与场景雾体同一公式（天空组 uniform 由调用方绑定），
 * 局部变量名保留 `srSkyBlend`，便于云层注入回归测试定位拼接顺序。
 */
export const SLOWROADS_SKY_FOG_FRAGMENT = /* glsl */ `
    float srSkyBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColorA, fogColorB, srSkyBlend), vFogDepth);
`

/* ------------------------------------------------------------------------
 * 显示空间等价注入（编辑器 EffectComposer 管线专用）
 *
 * 片元体顺序（与官方/lab 的「tonemapping → colorspace → fog」逐项一致）：
 *   1) 基色 → 显示空间：tone-mapped 材质走 `sRGB(Cineon(x · exposure))`；
 *      只带 colorspace_fragment 的自定义材质（水面）走 `sRGB(x)`；
 *   2) `mix(color, fogColorC, vHaze)`；
 *   3) `mix(color, mix(fogColorA, fogColorB, blend), vFogDepth)`，blend 与官方
 *      完全相同（允许 > 1 外推）。
 * 调用方的追加片元体（云层 / 星空混合）必须夹在混色与 `SR_EPILOGUE` 之间，
 * 因为它们同样消费/输出显示空间颜色（官方顺序亦如此）。
 *   4) 尾体把显示色换回渲染 target 的线性域：OutputPass 会再次应用
 *      `sRGB(Cineon(· · exposure))`，从而精确还原第 3 步的显示色。
 * ------------------------------------------------------------------------ */

/** 显示空间辅助函数（并入 fog_pars_fragment；仅片元使用）。 */
const FOG_DISPLAY_SPACE_PARS = /* glsl */ `
    uniform float srDisplayExposure;

    vec3 srFogSrgbEncode(vec3 value) {
        return mix(
            pow(max(value, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055),
            value * 12.92,
            vec3(lessThanEqual(value, vec3(0.0031308)))
        );
    }

    vec3 srFogSrgbDecode(vec3 value) {
        return mix(
            pow(max(value, vec3(0.0)) * 0.9478672986 + vec3(0.0521327014), vec3(2.4)),
            value * 0.0773993808,
            vec3(lessThanEqual(value, vec3(0.04045)))
        );
    }

    /** three CineonToneMapping（含 pow(·, 2.2)）的显示空间编码。 */
    vec3 srFogDisplayFromToneMapped(vec3 linearColor) {
        vec3 c = max(vec3(0.0), linearColor * srDisplayExposure - 0.004);
        vec3 coreCurve = (c * (6.2 * c + 0.5)) / (c * (6.2 * c + 1.7) + 0.06);
        return srFogSrgbEncode(pow(coreCurve, vec3(2.2)));
    }

    /** 只经过 colorspace_fragment（无色调映射）的材质的显示空间编码。 */
    vec3 srFogDisplayFromColorSpaceOnly(vec3 linearColor) {
        return srFogSrgbEncode(max(linearColor, vec3(0.0)));
    }

    /** Cineon 核心曲线的解析反函数（两根取正根；三次以下为数值稳定区）。 */
    float srFogCineonCoreInverse(float value) {
        float y = clamp(value, 0.0, 0.9995);
        float a = 6.2 * (y - 1.0);
        float b = 1.7 * y - 0.5;
        float c = 0.06 * y;
        float s = sqrt(max(b * b - 4.0 * a * c, 0.0));
        float r1 = (-b + s) / (2.0 * a);
        float r2 = (-b - s) / (2.0 * a);
        return max(r1, r2);
    }

    /** 显示色 → 渲染 target 线性域（OutputPass 的逆变换）。 */
    vec3 srFogDisplayToTargetLinear(vec3 displayColor) {
        vec3 value = pow(srFogSrgbDecode(clamp(displayColor, vec3(0.0), vec3(0.9995))), vec3(1.0 / 2.2));
        return (vec3(
            srFogCineonCoreInverse(value.r),
            srFogCineonCoreInverse(value.g),
            srFogCineonCoreInverse(value.b)
        ) + vec3(0.004)) / max(srDisplayExposure, 0.0001);
    }
`

const FOG_DISPLAY_SPACE_BODY_TONE_MAPPED = /* glsl */ `
    gl_FragColor.rgb = srFogDisplayFromToneMapped(gl_FragColor.rgb);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);
    gl_FragColor.rgb = mix(
        gl_FragColor.rgb,
        mix(fogColorA, fogColorB, max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend),
        vFogDepth
    );
`

const FOG_DISPLAY_SPACE_BODY_SKY = /* glsl */ `
    float srSkyBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend;
    gl_FragColor.rgb = srFogDisplayFromToneMapped(gl_FragColor.rgb);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColorA, fogColorB, srSkyBlend), vFogDepth);
`

const FOG_DISPLAY_SPACE_BODY_COLOR_SPACE_ONLY = /* glsl */ `
    gl_FragColor.rgb = srFogDisplayFromColorSpaceOnly(gl_FragColor.rgb);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);
    gl_FragColor.rgb = mix(
        gl_FragColor.rgb,
        mix(fogColorA, fogColorB, max(((vFogPos.y - cameraPosition.y) * 2.0) / max(0.001, distance(vFogPos, cameraPosition)), 0.0) * vFogBlend),
        vFogDepth
    );
`

/** 尾体：显示色 → 渲染 target 线性域。必须排在任何追加片元体之后。 */
const FOG_DISPLAY_SPACE_EPILOGUE = /* glsl */ `
    gl_FragColor.rgb = srFogDisplayToTargetLinear(gl_FragColor.rgb);
`

const FOG_PARS_FRAGMENT_DISPLAY_SPACE = `${FOG_PARS_FRAGMENT}\n${FOG_DISPLAY_SPACE_PARS}`

/** 材质基色在 lab/官方管线里到达雾片元时的显示空间编码方式。 */
export type SlowroadsFogBaseSpace = 'tone-mapped' | 'color-space'

export interface SlowroadsFogUniforms {
  fogColorA: THREE.IUniform<THREE.Color>
  fogColorB: THREE.IUniform<THREE.Color>
  fogColorC: THREE.IUniform<THREE.Color>
  fogNear: THREE.IUniform<number>
  fogFar: THREE.IUniform<number>
  fogDensity: THREE.IUniform<number>
  hazeHeight: THREE.IUniform<number>
  hazeIntensity: THREE.IUniform<number>
  /** 延后色调映射管线：OutputPass 的色调映射曝光（显示空间等价注入使用）。 */
  srDisplayExposure: THREE.IUniform<number>
}

/**
 * 场景组共享雾 uniform：地形 / 植被 / 道路 / 水面 / 降雪使用官方
 * `ENVIRONMENT_VIEW_DISTANCE`(1000) 尺度。同一 JS realm 内所有 SR 材质绑定同一组
 * 实例；环境运行时每帧写入一次即可全场景生效。多场景同页并存不受支持（与官方一致）。
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
  srDisplayExposure: { value: 1 },
}

/**
 * 天空组共享雾 uniform：天空平面 / 云层 / 星空使用官方 `n1 = tileSize × 2`(=2000)
 * 尺度的参数（`resolveSkyFogParams`），与地形/植被的「场景组」互不影响。
 * `skyDepthCorrection` 仅供天空平面顶点雾使用（相机远裁剪面压近时的等效换算）。
 */
export interface SlowroadsSkyFogUniforms extends SlowroadsFogUniforms {
  skyDepthCorrection: THREE.IUniform<number>
}

export const slowroadsSkyFogUniforms: SlowroadsSkyFogUniforms = {
  fogColorA: { value: new THREE.Color(1, 1, 1) },
  fogColorB: { value: new THREE.Color(1, 1, 1) },
  fogColorC: { value: new THREE.Color(1, 1, 1) },
  fogNear: { value: 0 },
  fogFar: { value: 2000 },
  fogDensity: { value: 0.001 },
  hazeHeight: { value: 0 },
  hazeIntensity: { value: 0 },
  skyDepthCorrection: { value: 1 },
  srDisplayExposure: slowroadsFogUniforms.srDisplayExposure,
}

/**
 * 显示空间等价注入开关（编辑器 EffectComposer 管线）。
 *
 * 片元体在编译期决定，因此必须在 SR 材质首次渲染前设置；运行时（环境运行时构造
 * 函数）设置一次，并调用 `refreshSlowroadsFogMaterials()` 让已注册的材质重新编译。
 * preview / viewer 直出画布保持关闭（与 lab 逐字一致）。
 */
let displaySpaceFogEnabled = false

export function setSlowroadsFogDisplaySpaceMode(enabled: boolean): void {
  displaySpaceFogEnabled = enabled === true
}

export function isSlowroadsFogDisplaySpaceMode(): boolean {
  return displaySpaceFogEnabled
}

/** 已注册（注入过 SR 雾）的材质；模式切换后需要重新编译。 */
const injectedMaterials = new Set<THREE.Material>()

function registerInjectedMaterial(material: THREE.Material | undefined): void {
  if (material) {
    injectedMaterials.add(material)
  }
}

/** 模式切换后让已注入材质重新编译（含 onBeforeCompile 再次执行）。 */
export function refreshSlowroadsFogMaterials(): void {
  for (const material of injectedMaterials) {
    material.needsUpdate = true
  }
}

/** 把场景组共享实例绑定到某个材质的 uniforms（内置材质在 onBeforeCompile 里调用）。 */
export function bindSlowroadsFogUniforms(uniforms: Record<string, THREE.IUniform>): void {
  for (const [key, uniform] of Object.entries(slowroadsFogUniforms)) {
    uniforms[key] = uniform as THREE.IUniform
  }
}

/** 天空/云层/星空的内置材质在 onBeforeCompile 里绑定天空组。 */
export function bindSlowroadsSkyFogUniforms(uniforms: Record<string, THREE.IUniform>): void {
  for (const [key, uniform] of Object.entries(slowroadsSkyFogUniforms)) {
    uniforms[key] = uniform as THREE.IUniform
  }
}

/**
 * 天空平面的"官方距离等效"换算系数 = 官方天空距离 / 实际平面距离。
 * 相机远裁剪面把天空平面压近时 > 1；不裁剪时 = 1（与官方/lab 逐字一致）。
 */
export function setSlowroadsSkyDepthCorrection(correction: number): void {
  slowroadsSkyFogUniforms.skyDepthCorrection.value =
    Number.isFinite(correction) && correction >= 1 ? correction : 1
}

/** 一组三色雾颜色（工作色空间，对应官方 `fog.colorA/colorB/colorC`）。 */
export interface SlowroadsFogColorSet {
  colA: THREE.Color
  colB: THREE.Color
  colC: THREE.Color
}

/**
 * 官方 three 构建里的 `Bs(i)`：渲染到画布时按 `renderer.outputColorSpace`
 * （默认 sRGB）推入雾色，渲染到 render target 时才用工作色空间。
 */
export function resolveFogUniformColorSpace(renderer: THREE.WebGLRenderer): THREE.ColorSpace {
  // @types/three 把 outputColorSpace / workingColorSpace 都标成 string，这里收窄回 ColorSpace。
  const colorSpace = renderer.getRenderTarget() === null
    ? renderer.outputColorSpace
    : THREE.ColorManagement.workingColorSpace
  return colorSpace as THREE.ColorSpace
}

/**
 * 官方 `refreshFogUniforms` 的等价物：
 * `f.colorA.getRGB(m.fogColorA.value, Bs(i))` —— 把工作色空间的雾色换算成
 * uniform 需要的输出色空间分量（渲染到画布时数值就等于预设 hex 的 sRGB 分量）。
 */
export function writeFogUniformColors(
  source: SlowroadsFogColorSet,
  target: SlowroadsFogColorSet,
  colorSpace: THREE.ColorSpace,
): void {
  source.colA.getRGB(target.colA, colorSpace)
  source.colB.getRGB(target.colB, colorSpace)
  source.colC.getRGB(target.colC, colorSpace)
}

/* ------------------------------------------------------------------------
 * JS 侧的显示空间等价模型（与 GLSL 逐项对应；供自检 / 单测使用）
 * ------------------------------------------------------------------------ */

/** three 的 sRGB 传输函数（encode = 线性 → 显示分量）。 */
export function slowroadsSrgbEncode(value: number): number {
  const v = Math.min(Math.max(value, 0), 1)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

export function slowroadsSrgbDecode(value: number): number {
  const v = Math.min(Math.max(value, 0), 1)
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** three CineonToneMapping 核心曲线（不含 `pow(·, 2.2)` 与 sRGB 编码）。 */
export function slowroadsCineonCore(value: number): number {
  const x = Math.max(0, value - 0.004)
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06)
}

/**
 * three 的 CineonToneMapping（r165+ 起含结尾 `pow(·, 2.2)`）+ sRGB 编码：
 * `display = sRGB(pow(core(max(0, x · exposure - 0.004)), 2.2))`。
 */
export function slowroadsDisplayFromToneMappedLinear(value: number, exposure = 1): number {
  const core = slowroadsCineonCore(value * exposure)
  return slowroadsSrgbEncode(Math.pow(core, 2.2))
}

/** 只经过 colorspace_fragment（无色调映射）的材质的显示空间编码。 */
export function slowroadsDisplayFromColorSpaceLinear(value: number): number {
  return slowroadsSrgbEncode(Math.min(Math.max(value, 0), 1))
}

/** Cineon 核心曲线的解析反函数（与 GLSL `srFogCineonCoreInverse` 同式）。 */
export function slowroadsCineonCoreInverse(value: number): number {
  const y = Math.min(Math.max(value, 0), 0.9995)
  const a = 6.2 * (y - 1)
  const b = 1.7 * y - 0.5
  const c = 0.06 * y
  const s = Math.sqrt(Math.max(b * b - 4 * a * c, 0))
  const r1 = (-b + s) / (2 * a)
  const r2 = (-b - s) / (2 * a)
  return Math.max(r1, r2)
}

/** 显示色 → 渲染 target 线性域（OutputPass 逆变换）。 */
export function slowroadsDisplayToTargetLinear(display: number, exposure = 1): number {
  const value = Math.pow(slowroadsSrgbDecode(Math.min(Math.max(display, 0), 0.9995)), 1 / 2.2)
  return (slowroadsCineonCoreInverse(value) + 0.004) / (exposure > 0 ? exposure : 1)
}

/**
 * 端到端模拟（单个显示分量）：显示空间等价注入写入 target 的线性值，经
 * OutputPass（`sRGB(Cineon(· · exposure))`）输出后的显示分量。
 * 用于断言「编辑器延后色调映射管线的最终显示色 == lab 显示空间混色」。
 */
export function slowroadsDeferredDisplayChannel(display: number, exposure = 1): number {
  const targetLinear = slowroadsDisplayToTargetLinear(display, exposure)
  const core = slowroadsCineonCore(targetLinear * exposure)
  return slowroadsSrgbEncode(Math.pow(core, 2.2))
}

function writeFogParams(
  uniforms: SlowroadsFogUniforms,
  params: ResolvedFogParams,
  colors: SlowroadsFogColorSet,
): void {
  uniforms.fogNear.value = params.near
  uniforms.fogFar.value = params.far
  uniforms.fogDensity.value = params.density
  uniforms.hazeHeight.value = params.hazeHeight
  uniforms.hazeIntensity.value = params.hazeIntensity
  uniforms.fogColorA.value.copy(colors.colA)
  uniforms.fogColorB.value.copy(colors.colB)
  uniforms.fogColorC.value.copy(colors.colC)
}

/**
 * 下发「场景组」雾参数（地形 / 植被 / 道路 / 水面 / 降雪）。
 * `colors` 必须是已按目标色空间换算/预补偿后的分量。
 */
export function setSlowroadsFogParams(params: ResolvedFogParams, colors: SlowroadsFogColorSet): void {
  writeFogParams(slowroadsFogUniforms, params, colors)
}

/**
 * 下发「天空组」雾参数（天空 / 云层 / 星空，官方 n1 = 2000 尺度）。
 * `colors` 与场景组同源（同一预设），只需换算一次。
 */
export function applySkyFogParams(params: ResolvedFogParams, colors: SlowroadsFogColorSet): void {
  writeFogParams(slowroadsSkyFogUniforms, params, colors)
}

export interface PatchedShader {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

export interface SlowroadsFogFragmentSequenceOptions {
  /** 绑定哪一组共享 uniform（尺度不同：场景组 1000 / 天空组 2000 尺度）。 */
  group?: 'scene' | 'sky'
  /** 片元体文本变体（变量名 `fogBlend` / `srSkyBlend`；数学一致）。 */
  body?: 'scene' | 'sky'
  /** 基色到达雾片元前的显示空间编码方式（水面只过 colorspace_fragment）。 */
  base?: SlowroadsFogBaseSpace
  /**
   * 追加片元体（云层混合 / 星空混合）：在显示空间模式下夹在混色与尾体之间，
   * 直出模式下紧随原始雾体（与 lab 一致）。
   */
  append?: string
  /** 用于注册（模式切换后重新编译）。 */
  material?: THREE.Material
}

/**
 * 片元侧注入的公共实现（雾体 + 可选追加体 + 尾体）。
 *
 * - 直出画布（lab 同款）：`fog_pars_fragment` + 原始雾体（+ 追加体），混色发生在
 *   显示空间（three 已把 tonemapping/colorspace 排在雾 chunk 之前）。
 * - 延后色调映射（编辑器）：改用显示空间等价雾体 + 追加体 + 尾体。
 */
export function injectSlowroadsFogFragmentSequence(
  shader: PatchedShader,
  options: SlowroadsFogFragmentSequenceOptions = {},
): boolean {
  const group = options.group ?? 'scene'
  const body = options.body ?? 'scene'
  const append = options.append ?? ''
  const base = options.base ?? 'tone-mapped'
  registerInjectedMaterial(options.material)
  if (
    displaySpaceFogEnabled
    && base === 'tone-mapped'
    && options.material
    && options.material.toneMapped === false
  ) {
    // 显示空间等价的前半段必须与 lab/官方在该材质上的处理一致：材质被排除在
    // 色调映射之外时（lab 侧同样不会过 Cineon），基色编码应改用 'color-space'。
    console.warn(
      `[SceneryLandscape] fog display-space injection: material "${options.material.name || options.material.type}" `
        + 'has toneMapped=false but uses the tone-mapped base encoding',
    )
  }

  if (group === 'sky') {
    bindSlowroadsSkyFogUniforms(shader.uniforms)
  } else {
    bindSlowroadsFogUniforms(shader.uniforms)
  }

  let ok = true
  if (shader.fragmentShader.includes('#include <fog_pars_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_pars_fragment>',
      displaySpaceFogEnabled ? FOG_PARS_FRAGMENT_DISPLAY_SPACE : FOG_PARS_FRAGMENT,
    )
  } else {
    ok = false
  }

  if (shader.fragmentShader.includes('#include <fog_fragment>')) {
    let replacement: string
    if (displaySpaceFogEnabled) {
      const displayBody = body === 'sky'
        ? FOG_DISPLAY_SPACE_BODY_SKY
        : base === 'color-space'
          ? FOG_DISPLAY_SPACE_BODY_COLOR_SPACE_ONLY
          : FOG_DISPLAY_SPACE_BODY_TONE_MAPPED
      replacement = append
        ? `${displayBody}\n${append}\n${FOG_DISPLAY_SPACE_EPILOGUE}`
        : `${displayBody}\n${FOG_DISPLAY_SPACE_EPILOGUE}`
    } else {
      const legacyBody = body === 'sky' ? SLOWROADS_SKY_FOG_FRAGMENT : SLOWROADS_FOG_FRAGMENT
      replacement = append ? `${legacyBody}\n${append}` : legacyBody
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', replacement)
  } else {
    ok = false
  }

  return ok
}

/**
 * 顶点侧注入：替换 fog_pars_vertex / fog_vertex 两个 include。
 * 返回是否全部命中（用于自检/测试）。
 */
export function injectSlowroadsFogVertex(shader: PatchedShader, material?: THREE.Material): boolean {
  let ok = true
  registerInjectedMaterial(material)
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

/** 片元侧注入（场景材质）：替换 fog_pars_fragment / fog_fragment 两个 include。 */
export function injectSlowroadsFogFragment(
  shader: PatchedShader,
  options: Omit<SlowroadsFogFragmentSequenceOptions, 'group' | 'body'> = {},
): boolean {
  return injectSlowroadsFogFragmentSequence(shader, { ...options, group: 'scene', body: 'scene' })
}

export function injectSlowroadsFog(
  shader: PatchedShader,
  options: Omit<SlowroadsFogFragmentSequenceOptions, 'group' | 'body'> = {},
): boolean {
  const vertexOk = injectSlowroadsFogVertex(shader, options.material)
  const fragmentOk = injectSlowroadsFogFragment(shader, options)
  return vertexOk && fragmentOk
}

/**
 * 片元侧注入（天空/云层/星空专用）：绑定**天空组** uniform，雾体与场景组同一公式。
 *
 * `appendFragmentBody` 用于在同一次替换里把调用方片元体（如云层混合）拼在雾体
 * 之后：该 include 被替换后即不存在，拆成第二次 replace 会静默失配（云层曾因此
 * 完全不绘制）。官方同样要求调用方片元体紧跟雾体、共享 main 作用域。
 */
export function injectSlowroadsSkyFogFragment(
  shader: PatchedShader,
  appendFragmentBody = '',
  material?: THREE.Material,
): boolean {
  return injectSlowroadsFogFragmentSequence(shader, {
    group: 'sky',
    body: 'sky',
    append: appendFragmentBody,
    material,
  })
}

/** 供自检/测试使用：确认当前注入文本包含关键记号。 */
export function slowroadsFogInjectionSource(): {
  vertexPars: string
  vertexBody: string
  fragmentPars: string
  fragmentBody: string
  fragmentSkyBody: string
  skyVertexPars: string
  skyVertexBody: string
  displaySpaceEnabled: boolean
  displayFragmentPars: string
  displayFragmentBody: string
  displayFragmentSkyBody: string
  displayFragmentBodyColorSpace: string
  displayFragmentEpilogue: string
} {
  return {
    vertexPars: FOG_PARS_VERTEX,
    vertexBody: FOG_VERTEX,
    fragmentPars: FOG_PARS_FRAGMENT,
    fragmentBody: SLOWROADS_FOG_FRAGMENT,
    fragmentSkyBody: SLOWROADS_SKY_FOG_FRAGMENT,
    skyVertexPars: FOG_PARS_VERTEX_SKY,
    skyVertexBody: FOG_VERTEX_SKY,
    displaySpaceEnabled: displaySpaceFogEnabled,
    displayFragmentPars: FOG_PARS_FRAGMENT_DISPLAY_SPACE,
    displayFragmentBody: FOG_DISPLAY_SPACE_BODY_TONE_MAPPED,
    displayFragmentSkyBody: FOG_DISPLAY_SPACE_BODY_SKY,
    displayFragmentBodyColorSpace: FOG_DISPLAY_SPACE_BODY_COLOR_SPACE_ONLY,
    displayFragmentEpilogue: FOG_DISPLAY_SPACE_EPILOGUE,
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
    // 官方未夹紧：相机降到雾层基准面以下（cameraY < 0）时 e > 1，
    // `far = base.far · (1 - e · min(0.9, hazeIntensity))` 会变成负数 →
    // 片元里 `max(0.001, fogFar - fogNear)` 把 `fogFar/(fogFar-fogNear)` 变成 -2.5e5，
    // vFogDepth 归 0；顶点 `vHaze`（天空平面 ±5e4，屏幕中部 ≈ 数百）的巨值外推不再被
    // A/B 混色遮住 → 天空整片变红（用户实测：秋·早晨在低机位显示红色）。
    // 与负 hazeHeight 分支一致夹到 1：雾层内效果不变，越界时不再反号。
    if (e > 1) {
      e = 1
    }
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
