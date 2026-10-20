/**
 * 地表注入的可编译性冒烟测试（不依赖 GPU）：
 *  - 注入后的片元里 `normal` 的引用必须晚于 `<normal_fragment_begin>`（否则 GLSL 未声明）；
 *  - 注入后的顶点里 `transformed` 只声明一次（`begin_vertex` 只能出现一次）；
 *  - 光照合成补丁与 fresnel/emissive 的顺序符合官方语义。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
} from '@schema/proceduralLandscape/surfaceMaterial'
import { createFoliageMaterial, createFoliageShaderUniforms } from '@schema/proceduralLandscape/instancing'
import { createTreeMeshManager, parseTreeBin } from '@schema/proceduralLandscape/treeMeshes'

function compileSources(material: THREE.Material): { vertex: string; fragment: string } {
  const parameters = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  } as unknown as Parameters<typeof material.onBeforeCompile>[0]
  material.onBeforeCompile(parameters, { capabilities: { maxTextures: 32 } } as never)
  return { vertex: parameters.vertexShader, fragment: parameters.fragmentShader }
}

describe('surface injection compilability', () => {
  it('keeps a single begin_vertex declaration and a resolvable normal', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial())
    const uniforms = createProceduralLandscapeSurfaceUniforms()
    const patch = applyProceduralLandscapeSurfaceInjection([mesh], uniforms)
    expect(patch.hasInjection).toBe(true)
    const material = mesh.material as unknown as THREE.MeshLambertMaterial
    const { vertex, fragment } = compileSources(material)

    // 顶点：begin_vertex 只允许出现一次（重复声明 transformed）。
    expect(vertex.split('#include <begin_vertex>').length - 1).toBe(1)

    // 片元：`normal` 的首次引用必须晚于 normal_fragment_begin。
    const normalDeclIndex = fragment.indexOf('#include <normal_fragment_begin>')
    const normalUseIndex = fragment.indexOf('normalize(cameraPosition - vPlWorldPosition)')
    expect(normalDeclIndex).toBeGreaterThanOrEqual(0)
    expect(normalUseIndex).toBeGreaterThan(normalDeclIndex)

    // fresnel 之后才写 totalEmissiveRadiance（官方：先 fresnel 再「色 × radiance」）。
    const fresnelIndex = fragment.indexOf('plFresnelFactor')
    const emissiveIndex = fragment.indexOf('totalEmissiveRadiance = plSeasonalColor * uPlRadiance;')
    expect(fresnelIndex).toBeGreaterThanOrEqual(0)
    expect(emissiveIndex).toBeGreaterThan(fresnelIndex)
    expect(fragment).toContain('uPlTreeLineMidY')
    expect(fragment).toContain('uPlTreeLineTopY')
    expect(fragment).toContain('treeMask *= plTreeLine')

    patch.restore()
  })

  it('keeps a single begin_vertex declaration for the road band', async () => {
    const { createRoadBand } = await import('@schema/proceduralLandscape/roadBand')
    const handle = createRoadBand({
      nodes: [
        { x: 0, z: 0, y: 0, heading: 0 },
        { x: 8, z: 0, y: 0, heading: 0 },
      ] as never,
      halfWidth: 3.5,
      density: null,
      textures: { base: new THREE.Texture(), overlay: null },
      season: 'spring',
      hostInverse: null,
    })
    const material = handle.mesh.material as THREE.MeshLambertMaterial
    const { vertex } = compileSources(material)
    expect(vertex.split('#include <begin_vertex>').length - 1).toBe(1)
    expect(vertex).toContain('vRoadWorldPosition')
    handle.dispose()
  })

  it('replaces the fresh white DEM roadbed material with the seasonal surface', () => {
    const geometry = new THREE.PlaneGeometry(20, 40, 4, 8)
    geometry.setAttribute(
      'aBaseHeight',
      new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count), 1),
    )
    geometry.setAttribute(
      'aBaseNormal',
      new THREE.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 3).fill(0),
        3,
      ),
    )
    const baseNormal = geometry.getAttribute('aBaseNormal') as THREE.BufferAttribute
    for (let index = 0; index < baseNormal.count; index += 1) {
      baseNormal.setXYZ(index, 0, 1, 0)
    }
    const original = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    })
    const roadbed = new THREE.Mesh(geometry, original)
    const patch = applyProceduralLandscapeSurfaceInjection(
      [roadbed],
      createProceduralLandscapeSurfaceUniforms(),
      {
        overridesForMesh: () => ({
          uPlRoadbedCutProx: 0,
          uPlUseBaseSurface: 1,
          uPlRoadDisplacement: 0,
          uPlFlattenStrength: 0,
          uPlShowCanopy: 0,
          uPlRoadbedBrightness: 1.1,
        }),
      },
    )

    expect(patch.patchedMaterialCount).toBe(1)
    expect(roadbed.material).not.toBe(original)
    expect((roadbed.material as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true)
    expect((roadbed.material as THREE.MeshLambertMaterial).side).toBe(THREE.DoubleSide)

    patch.restore()
    expect(roadbed.material).toBe(original)
    original.dispose()
    geometry.dispose()
  })
})

/** 构造一个最小合法 treebin（3 顶点 / 3 索引），供近树材质编译测试使用。 */
function createMinimalTreeBin(): ArrayBuffer {
  const vertexCount = 3
  const indexCount = 3
  const byteLength = 20 + vertexCount * (3 + 3 + 2) * 4 + indexCount * 2
  const buffer = new ArrayBuffer(byteLength)
  const view = new DataView(buffer)
  view.setUint32(0, 0x53525442, false)
  view.setUint32(4, 1, true)
  view.setUint32(8, vertexCount, true)
  view.setUint32(12, indexCount, true)
  view.setUint32(16, 16, true)
  let offset = 20
  for (let i = 0; i < vertexCount * 3; i += 1) {
    view.setFloat32(offset, i % 3 === 1 ? i : 0.5, true)
    offset += 4
  }
  for (let i = 0; i < vertexCount * 3; i += 1) {
    view.setFloat32(offset, i % 3 === 1 ? 1 : 0, true)
    offset += 4
  }
  for (let i = 0; i < vertexCount * 2; i += 1) {
    view.setFloat32(offset, i % 2, true)
    offset += 4
  }
  for (let i = 0; i < indexCount; i += 1) {
    view.setUint16(offset, i, true)
    offset += 2
  }
  return buffer
}

function createOffsetTreeBin(): ArrayBuffer {
  const vertexCount = 3
  const indexCount = 3
  const buffer = new ArrayBuffer(20 + vertexCount * 8 * 4 + indexCount * 2)
  const view = new DataView(buffer)
  view.setUint32(0, 0x53525442, false)
  view.setUint32(4, 1, true)
  view.setUint32(8, vertexCount, true)
  view.setUint32(12, indexCount, true)
  view.setUint32(16, 16, true)
  let offset = 20
  const positions = [
    0, -2, 0,
    1, 0, 0,
    0, 2, 0,
  ]
  for (const value of positions) {
    view.setFloat32(offset, value, true)
    offset += 4
  }
  for (let i = 0; i < vertexCount * 3; i += 1) {
    view.setFloat32(offset, i % 3 === 1 ? 1 : 0, true)
    offset += 4
  }
  for (let i = 0; i < vertexCount * 2; i += 1) {
    view.setFloat32(offset, i % 2, true)
    offset += 4
  }
  for (let i = 0; i < indexCount; i += 1) {
    view.setUint16(offset, i, true)
    offset += 2
  }
  return buffer
}

describe('double-sided foliage lighting normal (背面不翻转)', () => {
  it('normalizes negative-Y tree models to stand on the terrain', () => {
    const parsed = parseTreeBin(createOffsetTreeBin())
    parsed.geometry.computeBoundingBox()
    expect(parsed.geometry.boundingBox?.min.y).toBeCloseTo(0, 6)
    expect(parsed.geometry.boundingBox?.max.y).toBeCloseTo(4, 6)
    expect(parsed.unitScale).toBeCloseTo(2, 6)
    parsed.geometry.dispose()
  })

  it('foliage uses the per-instance ground normal without the DOUBLE_SIDED flip', () => {
    const material = createFoliageMaterial(
      {
        kind: 'grass',
        tier: 'all',
        species: 0,
        singlePlane: false,
        tint: 0xffffff,
        farTintScale: 1,
        hasAlphaTexture: false,
        hasNormalTexture: false,
        card: null,
        lodFade: null,
        staticBillboard: false,
        distanceAlpha: false,
        useDensityShadow: true,
        key: 'test:grass',
      },
      createFoliageShaderUniforms(),
      { season: 'spring', discolouration: 1.5, hasSnow: false },
    ).material
    const { fragment } = compileSources(material)
    // 着色法线 = 每实例 groundNormal（视空间），且不再有背面翻转（否则背面 direct=0 发黑）。
    expect(fragment).toContain('normalize(mat3(viewMatrix) * vPlGroundNormal)')
    expect(fragment).not.toContain('normal *= faceDirection')
    expect(fragment).not.toContain('#include <normal_fragment_begin>')
  })

  it('near tree mesh leaf cards keep an unflipped vNormal', async () => {
    const manager = await createTreeMeshManager({
      assetStore: { modelBytes: async () => createMinimalTreeBin() } as never,
      hostInverse: null,
    })
    const mesh = manager.container.children[0] as THREE.InstancedMesh
    expect(mesh).toBeTruthy()
    const { fragment } = compileSources(mesh.material as THREE.MeshLambertMaterial)
    expect(fragment).toContain('normalize(mix(normalize(vNormal), treeUpView, 0.58))')
    expect(fragment).not.toContain('normal *= faceDirection')
    expect(fragment).not.toContain('#include <normal_fragment_begin>')
    manager.dispose()
  })
})

describe('camera-yaw independent foliage LOD', () => {
  it('uses horizontal distance for tree-card dissolve and bush alpha', () => {
    const season = { season: 'spring' as const, discolouration: 1.5, hasSnow: false }
    const nearCard = createFoliageMaterial(
      {
        kind: 'tree',
        tier: 'all',
        species: 0,
        singlePlane: false,
        tint: 0xffffff,
        farTintScale: 1,
        hasAlphaTexture: false,
        hasNormalTexture: true,
        card: 'near',
        lodFade: 'near-card',
        staticBillboard: false,
        distanceAlpha: false,
        useDensityShadow: true,
        key: 'test:near-card',
      },
      createFoliageShaderUniforms(),
      season,
    )
    const bush = createFoliageMaterial(
      {
        kind: 'bush',
        tier: 'all',
        species: 0,
        singlePlane: false,
        tint: 0xffffff,
        farTintScale: 1,
        hasAlphaTexture: false,
        hasNormalTexture: false,
        card: null,
        lodFade: null,
        staticBillboard: false,
        distanceAlpha: true,
        useDensityShadow: true,
        key: 'test:bush',
      },
      createFoliageShaderUniforms(),
      season,
    )

    const nearCardVertex = compileSources(nearCard.material).vertex
    const bushVertex = compileSources(bush.material).vertex

    // 相机原地水平旋转时视深会剧烈变化；LOD/alpha 必须只看水平距离。
    expect(nearCardVertex).toContain('clamp((plDistXZ - uPlDissolveNear) / uPlDissolveInterval')
    expect(nearCardVertex).not.toContain('clamp((plViewDepth - uPlDissolveNear)')
    expect(nearCardVertex).not.toContain('plViewDepth < uPlDissolveFar')
    expect(bushVertex).toContain('plDistXZ < 10.0')
    expect(bushVertex).not.toContain('plViewDepth < 10.0')
  })
})
