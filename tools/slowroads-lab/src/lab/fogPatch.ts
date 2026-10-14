import * as THREE from 'three'
import type { ResolvedFogParams } from '../core/environment'

/**
 * slowroads 三色高度雾（官方 fog chunk 原样移植）。
 *
 * 官方直接替换 three 的 `ShaderChunk.fog_*`，让所有材质（地形/植被/道路/水面/
 * 云层/星空）共用一套：圆柱（到相机）雾距、噪声起伏雾顶、正负 haze 层、
 * 视线水平向的 A/B 混色与 C 色去饱和。lab 采用同一机制：
 *  - `installSlowroadsFog()` 替换 ShaderChunk，并给 `UniformsLib.fog` 增加
 *    fogColorA/B/C、hazeHeight、hazeIntensity 字段（必须在任何材质创建前调用）；
 *  - `applyFogToMaterial()` / `applyFogToScene()` 把当前参数推给材质；
 *  - `updateHazeForCamera()` 复现官方按相机高度的 haze 层插值。
 *
 * 色彩空间（官方 `refreshFogUniforms` 等价物）：雾 chunk 被 three 排在
 * `tonemapping_fragment → colorspace_fragment → fog_fragment` 之后，混色发生在
 * **显示空间**，所以 fogColorA/B/C 必须按渲染输出色空间推入 —— 见
 * `resolveFogUniformColorSpace()` / `writeFogUniformColors()`；直接推工作色空间
 * （线性）分量会让雾与天空整体偏暗、偏饱和（粉/橙预设看上去"太红"）。
 */

const FOG_PARS_VERTEX = /* glsl */ `

#ifdef USE_FOG

	varying float vFogDepth;
    varying vec3 vFogPos;
	varying float vFogBlend;
	varying float vHaze;

    #ifdef FOG_EXP2
		uniform float fogDensity;
    #endif

	uniform float fogNear;
	uniform float fogFar;

    uniform float hazeHeight;
    uniform float hazeIntensity;

float noise(vec2 p, float freq ){
	float unit = 1024./freq;
	vec2 ij = floor(p/unit);
	vec2 xy = mod(p,unit)/unit;
	//xy = 3.*xy*xy-2.*xy*xy*xy;
	xy = .5*(1.-cos(PI*xy));
	float a = rand((ij+vec2(0.,0.)));
	float b = rand((ij+vec2(1.,0.)));
	float c = rand((ij+vec2(0.,1.)));
	float d = rand((ij+vec2(1.,1.)));
	float x1 = mix(a, b, xy.x);
	float x2 = mix(c, d, xy.x);
	return mix(x1, x2, xy.y);
}

float pNoise(vec2 p, int res){
	float persistance = .5;
	float n = 0.;
	float normK = 0.;
	float f = 4.;
	float amp = 1.;
	int iCount = 0;
	for (int i = 0; i<50; i++){
		n+=amp*noise(p, f);
		f*=2.;
		normK+=amp;
		amp*=persistance;
		if (iCount == res) break;
		iCount++;
	}
	float nf = n/normK;
	return nf*nf*nf*nf;
}


#endif
`

const FOG_VERTEX = /* glsl */ `

#ifdef USE_FOG

    vFogPos = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef USE_INSTANCING
        vFogPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    #endif


	//// FOG DEPTH

	// FLAT - can I do this if cheap?
	// float fogDepth = -mvPosition.z;

	// CYLINDRICAL
	// If cylindrical, have to pass in camera position to everything using fog. Do this in a module patch?
	float fogDepth = distance(vFogPos, cameraPosition);

	vHaze = fogDepth / fogFar;
	// vHaze *= vHaze;
	vHaze *= 1.0 + min(0.0, hazeIntensity);

	#ifdef FOG_EXP2
		vFogDepth = max(0.0, (fogDepth - fogNear) * (fogFar / (fogFar - fogNear)));
		vFogDepth = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else

		vFogDepth = smoothstep( fogNear, fogFar, fogDepth );
	#endif

	//// NOISE VARIATION
	float fogHeight = vFogPos.y;
	#ifdef FOG_EXP2
	    if(fogDepth < 1000.0) {
			fogHeight += pNoise(vFogPos.xz*2.0, 3) * hazeHeight * (fogDepth / 1000.0);
		} else {
			fogHeight += pNoise(vFogPos.xz*2.0, 3) * hazeHeight;
		}
	#endif

    //// HAZE
    if(hazeHeight > 0.0 && fogHeight < hazeHeight) {

		float haze = (1.0 - (fogHeight / hazeHeight)) * hazeIntensity;

		if(fogDepth < 50.0) {
			float fff = 1.0 - (fogDepth / 50.0);
			haze *= 1.0 - fff*fff;
		}

		if(haze < 0.0) {
			haze = 0.0;
		}

		vFogDepth += haze;

    } else if(hazeHeight < 0.0 && fogHeight > -hazeHeight) {

		float haze = min(1.0, (fogHeight / -hazeHeight) - 1.0) * hazeIntensity;

		if(fogDepth < 50.0) {
			float fff = 1.0 - (fogDepth / 50.0);
			haze *= 1.0 - fff*fff;
		}

		vFogDepth += haze;
    }


	float fogAvg = (fogFar + fogNear) / 2.0;
	vFogBlend = 1.0;
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

	//// LIMIT
	vFogDepth = min(1.0, vFogDepth);

#endif
`

const FOG_PARS_FRAGMENT = /* glsl */ `

#ifdef USE_FOG

	uniform vec3 fogColorA;
    uniform vec3 fogColorB;
	uniform vec3 fogColorC;
	varying float vFogDepth;
    varying vec3 vFogPos;
	varying float vFogBlend;
	varying float vHaze;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else


	#endif

	uniform float fogNear;
	uniform float fogFar;

    uniform float hazeHeight;
    uniform float hazeIntensity;

#endif
`

/**
 * 注意：官方云层片元复用这里的局部变量 `fogBlend`（在 main 作用域内），
 * 移植时保持同样的结构，不要在它外面再包函数。
 */
const FOG_FRAGMENT = /* glsl */ `

#ifdef USE_FOG

	// Cylindrical
	//float fogDepth = distance(vFogPos, cameraPosition);

	float fogBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / distance(vFogPos, cameraPosition), 0.0) * vFogBlend;

	//// DESATURATION EFFECT
	gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);

	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix(fogColorA, fogColorB, fogBlend), vFogDepth );

#endif
`

interface FogUniforms {
  fogColorA: THREE.IUniform<THREE.Color>
  fogColorB: THREE.IUniform<THREE.Color>
  fogColorC: THREE.IUniform<THREE.Color>
  hazeHeight: THREE.IUniform<number>
  hazeIntensity: THREE.IUniform<number>
  fogNear: THREE.IUniform<number>
  fogFar: THREE.IUniform<number>
  fogDensity?: THREE.IUniform<number>
}

/** 一组三色雾颜色（工作色空间，对应官方 `fog.colorA/colorB/colorC`）。 */
export interface FogColorSet {
  colA: THREE.Color
  colB: THREE.Color
  colC: THREE.Color
}

/**
 * 官方 three 构建里的 `Bs(i)`（`function Bs(i){return i.getRenderTarget()===null?i.outputColorSpace:$t}`，
 * `$t` = ColorManagement 工作色空间）：渲染到画布时雾色按 `renderer.outputColorSpace`
 * （默认 sRGB）推入，渲染到 render target 时才用工作色空间。lab 目前只渲染到画布，
 * 这里仍保留官方判据，便于将来接后处理 render target。
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
export function writeFogUniformColors(source: FogColorSet, target: FogColorSet, colorSpace: THREE.ColorSpace): void {
  source.colA.getRGB(target.colA, colorSpace)
  source.colB.getRGB(target.colB, colorSpace)
  source.colC.getRGB(target.colC, colorSpace)
}

let installed = false

/**
 * 共享的雾 uniform 实例：three 的内置材质（MeshBasic/Points）在模块加载时就把
 * ShaderLib.fog 快照走了，之后再扩展 UniformsLib.fog 不会出现在它们身上，
 * 因此内置材质必须在 onBeforeCompile 里绑定这一组共享实例。
 */
export const slowroadsFogUniforms = {
  fogColorA: { value: new THREE.Color(1, 1, 1) },
  fogColorB: { value: new THREE.Color(1, 1, 1) },
  fogColorC: { value: new THREE.Color(1, 1, 1) },
  fogNear: { value: 0 },
  fogFar: { value: 1000 },
  fogDensity: { value: 0.002 },
  hazeHeight: { value: 0 },
  hazeIntensity: { value: 0 },
} satisfies Record<string, THREE.IUniform> as Record<string, THREE.IUniform>

export function bindSlowroadsFogUniforms(uniforms: Record<string, THREE.IUniform>): void {
  for (const [key, uniform] of Object.entries(slowroadsFogUniforms)) {
    uniforms[key] = uniform
  }
}

export function installSlowroadsFog(): void {
  if (installed) {
    return
  }
  installed = true
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT
  Object.assign(THREE.UniformsLib.fog, {
    fogColorA: slowroadsFogUniforms.fogColorA,
    fogColorB: slowroadsFogUniforms.fogColorB,
    fogColorC: slowroadsFogUniforms.fogColorC,
    hazeHeight: slowroadsFogUniforms.hazeHeight,
    hazeIntensity: slowroadsFogUniforms.hazeIntensity,
  })
}

function materialFogUniforms(material: THREE.Material): FogUniforms | null {
  const uniforms = (material as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform> | undefined
  if (!uniforms || !uniforms.fogColorA || !uniforms.hazeHeight) {
    return null
  }
  return uniforms as unknown as FogUniforms
}

/**
 * Push the current fog params into one material (no-op when the material has no fog uniforms).
 * `colors` must already hold output-color-space components (see `writeFogUniformColors`).
 */
export function applyFogToMaterial(
  material: THREE.Material,
  params: ResolvedFogParams,
  colors: FogColorSet,
): void {
  const uniforms = materialFogUniforms(material)
  if (!uniforms) {
    return
  }
  uniforms.fogNear.value = params.near
  uniforms.fogFar.value = params.far
  if (uniforms.fogDensity) {
    uniforms.fogDensity.value = params.density
  }
  uniforms.hazeHeight.value = params.hazeHeight
  uniforms.hazeIntensity.value = params.hazeIntensity
  uniforms.fogColorA.value.copy(colors.colA)
  uniforms.fogColorB.value.copy(colors.colB)
  uniforms.fogColorC.value.copy(colors.colC)
}

export function applyFogToScene(
  scene: THREE.Scene,
  params: ResolvedFogParams,
  colors: FogColorSet,
): void {
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) {
      return
    }
    if (Array.isArray(material)) {
      for (const entry of material) {
        applyFogToMaterial(entry, params, colors)
      }
    } else {
      applyFogToMaterial(material, params, colors)
    }
  })
}

/**
 * 官方 updateAlways 里的 haze 高度插值：相机进入雾层（hazeHeight>0 表示层顶、
 * <0 表示层底）时拉近雾、增强 haze，离开后恢复基准参数。
 */
export interface HazeState {
  inHaze: boolean
}

export function updateHazeForCamera(
  base: ResolvedFogParams,
  cameraY: number,
  state: HazeState,
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
