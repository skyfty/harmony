/**
 * 公路贴图带路型回归测试：`createRoadBand()` 创建时必须直接套用季节贴图集
 * （划线 6 张 + `textureStretch`），不能等到换季的 `setSeason()` 才修正。
 *
 * 背景：runtime 每次重建公路（改路宽 / 重画路径 / 重新生成）都只调
 * `createRoadBand()`；若创建时把 `uRoadHasPaint` 固定为 0、`uRoadTextureStretch`
 * 固定为 1，宽路的划线与窄路（< 2.25m）的单车道拉伸就会在重建后丢失
 * （lab 建完 mesh 立刻 setSeason，所以 lab 表现正确）。
 * 这里不依赖 GPU：让材质跑一次 onBeforeCompile，直接断言注入后的 uniform。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createRoadBand, type RoadBandTextures } from '@schema/proceduralLandscape/roadBand'
import {
  clampProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
  type ProceduralLandscapeComponentProps,
} from '@schema/proceduralLandscape/config'
import {
  ROAD_SINGLE_TRACK_THRESHOLD,
  ROAD_WIDTH_PRESETS,
  isSingleTrackRoad,
} from '@schema/proceduralLandscape/roadStyle'

/** 公路带注入后我们真正关心的 uniform（缺字段会在访问时直接抛错 = 断言注入存在）。 */
interface RoadBandUniforms {
  uRoadMap: THREE.IUniform<THREE.Texture>
  uRoadHasOverlay: THREE.IUniform<number>
  uRoadHasPaint: THREE.IUniform<number>
  uRoadPaintDashed: THREE.IUniform<THREE.Texture>
  uRoadPaintSolidRight: THREE.IUniform<THREE.Texture>
  uRoadTextureStretch: THREE.IUniform<number>
  uRoadShadowFactor: THREE.IUniform<number>
}

function compileUniforms(mesh: THREE.Mesh): RoadBandUniforms {
  const material = mesh.material as THREE.Material
  const parameters = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  } as unknown as Parameters<typeof material.onBeforeCompile>[0]
  material.onBeforeCompile(parameters, { capabilities: { maxTextures: 32 } } as never)
  return parameters.uniforms as unknown as RoadBandUniforms
}

/** 宽路贴图集（`road` + 6 张划线），冬季之外的季节都用它。 */
function createWideTextures(textureStretch?: number): RoadBandTextures {
  return {
    base: new THREE.Texture(),
    overlay: new THREE.Texture(),
    paint: {
      dashed: new THREE.Texture(),
      solid: new THREE.Texture(),
      solidLeft: new THREE.Texture(),
      solidRight: new THREE.Texture(),
      mergeLeft: new THREE.Texture(),
      mergeRight: new THREE.Texture(),
    },
    textureStretch,
  }
}

/** 单车道贴图集（`roadSingle`，无划线）。 */
function createSingleTrackTextures(textureStretch?: number): RoadBandTextures {
  return {
    base: new THREE.Texture(),
    overlay: null,
    paint: null,
    textureStretch,
  }
}

function createBand(textures: RoadBandTextures, halfWidth: number) {
  return createRoadBand({
    nodes: [
      { x: 0, z: 0, y: 0, heading: 0 },
      { x: 8, z: 0, y: 0, heading: 0 },
    ] as never,
    halfWidth,
    density: null,
    textures,
    season: 'spring',
    hostInverse: null,
  })
}

describe('road band style applied at creation', () => {
  it('宽路贴图集：创建即启用划线，stretch = 1', () => {
    const textures = createWideTextures(1)
    const handle = createBand(textures, ROAD_WIDTH_PRESETS.regular / 2)
    const uniforms = compileUniforms(handle.mesh)

    expect(uniforms.uRoadMap.value).toBe(textures.base)
    expect(uniforms.uRoadHasOverlay.value).toBe(1)
    expect(uniforms.uRoadHasPaint.value).toBe(1)
    expect(uniforms.uRoadPaintDashed.value).toBe(textures.paint!.dashed)
    expect(uniforms.uRoadPaintSolidRight.value).toBe(textures.paint!.solidRight)
    expect(uniforms.uRoadTextureStretch.value).toBe(1)

    handle.dispose()
  })

  it('单车道贴图集（路宽 < 2.25m）：创建即 stretch = 2 且不启用划线', () => {
    const textures = createSingleTrackTextures(2)
    const handle = createBand(textures, ROAD_WIDTH_PRESETS.narrow / 2)
    const uniforms = compileUniforms(handle.mesh)

    expect(uniforms.uRoadMap.value).toBe(textures.base)
    expect(uniforms.uRoadHasOverlay.value).toBe(0)
    expect(uniforms.uRoadHasPaint.value).toBe(0)
    expect(uniforms.uRoadTextureStretch.value).toBe(2)

    handle.dispose()
  })

  it('未显式给 stretch 时按路宽回退（宽路 1 / 单车道 2）', () => {
    const wide = createBand(createWideTextures(), ROAD_WIDTH_PRESETS.regular / 2)
    expect(compileUniforms(wide.mesh).uRoadTextureStretch.value).toBe(1)
    wide.dispose()

    const single = createBand(createSingleTrackTextures(), ROAD_WIDTH_PRESETS.narrow / 2)
    expect(compileUniforms(single.mesh).uRoadTextureStretch.value).toBe(2)
    single.dispose()
  })

  it('setSeason 换季时路型与树影系数一起跟随', () => {
    const handle = createBand(createWideTextures(1), ROAD_WIDTH_PRESETS.regular / 2)
    const uniforms = compileUniforms(handle.mesh)
    expect(uniforms.uRoadHasPaint.value).toBe(1)
    expect(uniforms.uRoadShadowFactor.value).toBeCloseTo(0.8, 6) // spring

    const autumnSingle = createSingleTrackTextures(2)
    handle.setSeason('autumn', autumnSingle)
    expect(uniforms.uRoadMap.value).toBe(autumnSingle.base)
    expect(uniforms.uRoadHasPaint.value).toBe(0)
    expect(uniforms.uRoadTextureStretch.value).toBe(2)
    expect(uniforms.uRoadShadowFactor.value).toBeCloseTo(0.8, 6) // autumn

    // 冬季宽路官方无划线：贴图集不给 paint，stretch 回退到宽路档。
    const winterWide: RoadBandTextures = { base: new THREE.Texture(), overlay: new THREE.Texture() }
    handle.setSeason('winter', winterWide)
    expect(uniforms.uRoadMap.value).toBe(winterWide.base)
    expect(uniforms.uRoadHasPaint.value).toBe(0)
    expect(uniforms.uRoadTextureStretch.value).toBe(1)
    expect(uniforms.uRoadShadowFactor.value).toBeCloseTo(0.75, 6) // winter

    handle.dispose()
  })
})

describe('procedural landscape road width clamp', () => {
  const defaults = createDefaultProceduralLandscapeProps({ id: 'road-width' })

  function clampWidth(width: number): number {
    const props: Partial<ProceduralLandscapeComponentProps> = {
      road: { ...defaults.road, width },
    }
    return clampProceduralLandscapeProps(props, 'road-width').road.width
  }

  it('允许官方单车道档（1.8m）并夹住越界值', () => {
    expect(clampWidth(1.2)).toBe(ROAD_WIDTH_PRESETS.narrow)
    expect(clampWidth(ROAD_WIDTH_PRESETS.narrow)).toBe(ROAD_WIDTH_PRESETS.narrow)
    expect(clampWidth(7)).toBe(7)
    expect(clampWidth(24.1)).toBe(24)
  })

  it('放开下限后 1.8m 才真正进入单车道分支', () => {
    expect(ROAD_WIDTH_PRESETS.narrow).toBeLessThan(ROAD_SINGLE_TRACK_THRESHOLD)
    expect(isSingleTrackRoad(clampWidth(ROAD_WIDTH_PRESETS.narrow))).toBe(true)
    expect(isSingleTrackRoad(clampWidth(ROAD_WIDTH_PRESETS.regular))).toBe(false)
  })
})
