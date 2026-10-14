/**
 * Unit tests for the procedural landscape generation math (height grid
 * rasterization, road tracing, density determinism, chunk planning and the
 * road field encoding). Everything under test is pure so the editor vitest
 * setup is enough.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildTerrainHeightGrid,
  buildTerrainHeightGridFromSources,
  collectTerrainMeshSources,
} from '@schema/proceduralLandscape/terrainSampler'
import { traceRoadPath } from '@schema/proceduralLandscape/roadTrace'
import {
  buildForestDensityField,
  densityClassFromNoise,
} from '@schema/proceduralLandscape/densityField'
import {
  buildRoadFieldData,
  createRoadFieldTexture,
  decodeRoadDistance,
  encodeRoadDistance,
} from '@schema/proceduralLandscape/roadField'
import {
  planCameraGrassChunk,
  planRoadBucket,
  planTreeChunk,
  takeDensityPrefix,
} from '@schema/proceduralLandscape/chunkPlan'
import { fbm2 } from '@schema/proceduralLandscape/noise'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import {
  applyProceduralLandscapeSurfaceInjection,
  createProceduralLandscapeSurfaceUniforms,
} from '@schema/proceduralLandscape/surfaceMaterial'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import { visitExplicitComponentAssetReferences } from '@/utils/sceneExplicitAssetReferences'

function makeGridMesh(
  options: {
    minX?: number
    minZ?: number
    sizeX: number
    sizeZ: number
    segmentsX: number
    segmentsZ: number
    height: (x: number, z: number) => number
  },
): THREE.Mesh {
  const minX = options.minX ?? 0
  const minZ = options.minZ ?? 0
  const positions: number[] = []
  const indices: number[] = []
  const cols = options.segmentsX + 1
  for (let iz = 0; iz <= options.segmentsZ; iz += 1) {
    for (let ix = 0; ix <= options.segmentsX; ix += 1) {
      const x = minX + (ix / options.segmentsX) * options.sizeX
      const z = minZ + (iz / options.segmentsZ) * options.sizeZ
      positions.push(x, options.height(x, z), z)
    }
  }
  for (let iz = 0; iz < options.segmentsZ; iz += 1) {
    for (let ix = 0; ix < options.segmentsX; ix += 1) {
      const a = iz * cols + ix
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  const mesh = new THREE.Mesh(geometry)
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('terrain height grid', () => {
  it('rasterizes a planar slope and samples bilinearly', () => {
    const mesh = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 20,
      segmentsZ: 20,
      height: (x) => x * 0.1,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(5, 1)
    expect(grid!.sampleHeight(20, 80)).toBeCloseTo(2, 1)
    const normal = grid!.sampleNormal(50, 50)
    expect(normal).not.toBeNull()
    expect(normal!.y).toBeGreaterThan(0.9)
    expect(grid!.contains(50, 50)).toBe(true)
  })

  it('prefers the smallest triangle when LOD tiles overlap', () => {
    const coarse = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 2,
      segmentsZ: 2,
      height: () => 10,
    })
    const fine = makeGridMesh({
      minX: 40,
      minZ: 40,
      sizeX: 20,
      sizeZ: 20,
      segmentsX: 8,
      segmentsZ: 8,
      height: () => 5,
    })
    const root = new THREE.Group()
    root.add(coarse)
    root.add(fine)
    root.updateMatrixWorld(true)
    const grid = buildTerrainHeightGrid(root, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(5, 1)
    expect(grid!.sampleHeight(10, 10)).toBeCloseTo(10, 1)
  })

  it('returns null outside the covered area', () => {
    const mesh = makeGridMesh({
      sizeX: 50,
      sizeZ: 50,
      segmentsX: 10,
      segmentsZ: 10,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.contains(80, 80)).toBe(false)
  })

  it('ignores pick proxies, editor-only, hidden and helper meshes', () => {
    const root = new THREE.Group()
    const real = makeGridMesh({
      sizeX: 100,
      sizeZ: 100,
      segmentsX: 10,
      segmentsZ: 10,
      height: () => 3,
    })
    real.name = 'TerrainMesh'
    root.add(real)

    // The editor's instanced-rendering path adds an invisible box pick proxy;
    // it must never be rasterized into the height field.
    const pickProxy = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial())
    pickProxy.userData.instancedPickProxy = true
    root.add(pickProxy)

    const editorOnly = makeGridMesh({ sizeX: 100, sizeZ: 100, segmentsX: 2, segmentsZ: 2, height: () => 999 })
    editorOnly.userData.editorOnly = true
    root.add(editorOnly)

    const hidden = makeGridMesh({ sizeX: 100, sizeZ: 100, segmentsX: 2, segmentsZ: 2, height: () => 500 })
    hidden.visible = false
    root.add(hidden)

    const outline = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial())
    outline.name = 'InstancedOutline'
    root.add(outline)

    root.updateMatrixWorld(true)
    const sources = collectTerrainMeshSources(root)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.mesh).toBe(real)

    const grid = buildTerrainHeightGrid(root, { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.sampleHeight(50, 50)).toBeCloseTo(3, 1)
  })

  it('respects explicit source matrices for world-space sampling', () => {
    const mesh = makeGridMesh({ sizeX: 10, sizeZ: 10, segmentsX: 2, segmentsZ: 2, height: () => 0 })
    const matrix = new THREE.Matrix4().makeScale(10, 1, 10).setPosition(100, 5, -50)
    const grid = buildTerrainHeightGridFromSources([{ mesh, matrix }], { cellSize: 5, maxGridSize: 256 })
    expect(grid).not.toBeNull()
    expect(grid!.minX).toBeCloseTo(100, 3)
    expect(grid!.sampleHeight(150, 0)).toBeCloseTo(5, 2)
  })
})

describe('road tracing', () => {
  const baseOptions = {
    startX: 200,
    startZ: 200,
    headingRad: 0,
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: (32 * Math.PI) / 180,
    maxSlope: 0.55,
    maxTurnRad: (4 * Math.PI) / 180,
    maxLength: null,
    margin: 12,
  }

  it('walks straight across a flat terrain and stops at the boundary', () => {
    const mesh = makeGridMesh({
      sizeX: 400,
      sizeZ: 400,
      segmentsX: 40,
      segmentsZ: 40,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const result = traceRoadPath(grid, baseOptions)
    expect(result.nodes.length).toBeGreaterThan(5)
    expect(result.complete).toBe(true)
    expect(result.failureReason).toBe('reached-terrain-boundary')
    for (let i = 1; i < result.nodes.length; i += 1) {
      const node = result.nodes[i]!
      expect(node.x).toBeGreaterThanOrEqual(grid.minX)
      expect(node.x).toBeLessThanOrEqual(grid.maxX)
    }
    for (let i = 2; i < result.nodes.length; i += 1) {
      const previous = result.nodes[i - 1]!
      const current = result.nodes[i]!
      const turn = Math.abs(current.heading - previous.heading)
      expect(turn).toBeLessThanOrEqual(baseOptions.maxTurnRad * 1.01 + 1e-6)
    }
  })

  it('stops when every direction exceeds the slope limit', () => {
    const mesh = makeGridMesh({
      sizeX: 400,
      sizeZ: 400,
      segmentsX: 40,
      segmentsZ: 40,
      height: (x) => x * 1.5,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const result = traceRoadPath(grid, baseOptions)
    expect(result.complete).toBe(false)
    expect(result.failureReason).toBe('blocked')
    expect(result.nodes.length).toBe(1)
  })

  it('is deterministic for identical inputs', () => {
    const mesh = makeGridMesh({
      sizeX: 300,
      sizeZ: 300,
      segmentsX: 30,
      segmentsZ: 30,
      height: (x, z) => Math.sin(x * 0.02) * 4 + Math.cos(z * 0.03) * 2,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const first = traceRoadPath(grid, baseOptions)
    const second = traceRoadPath(grid, baseOptions)
    expect(second.nodes.map((node) => [node.x, node.z, node.y])).toEqual(
      first.nodes.map((node) => [node.x, node.z, node.y]),
    )
  })
})

describe('noise and density field', () => {
  it('keeps value noise deterministic', () => {
    expect(fbm2(7, 1.25, 3.5, 3)).toBe(fbm2(7, 1.25, 3.5, 3))
    expect(fbm2(7, 1.25, 3.5, 3)).not.toBe(fbm2(8, 1.25, 3.5, 3))
  })

  it('classifies density monotonically', () => {
    expect(densityClassFromNoise(0.1, 1)).toBe(0)
    expect(densityClassFromNoise(0.5, 1)).toBe(1)
    expect(densityClassFromNoise(0.62, 1)).toBe(2)
    expect(densityClassFromNoise(0.95, 1)).toBe(3)
    expect(densityClassFromNoise(0.5, 0)).toBe(0)
  })

  it('builds identical density fields for the same seed', () => {
    const options = {
      minX: 0,
      minZ: 0,
      sizeX: 512,
      sizeZ: 512,
      seed: 1234,
      scale: 600,
      coverage: 1,
      resolution: 64,
    }
    const first = buildForestDensityField(options)
    const second = buildForestDensityField(options)
    expect(Array.from(second.data)).toEqual(Array.from(first.data))
    const different = buildForestDensityField({ ...options, seed: 998877 })
    expect(Array.from(different.data)).not.toEqual(Array.from(first.data))
  })
})

describe('chunk planning', () => {
  function createDeps(roadEnabled: boolean) {
    const mesh = makeGridMesh({
      sizeX: 512,
      sizeZ: 512,
      segmentsX: 64,
      segmentsZ: 64,
      height: () => 0,
    })
    const grid = buildTerrainHeightGrid(mesh, { cellSize: 4, maxGridSize: 512 })!
    const density = buildForestDensityField({
      minX: grid.minX,
      minZ: grid.minZ,
      sizeX: grid.maxX - grid.minX,
      sizeZ: grid.maxZ - grid.minZ,
      seed: 42,
      scale: 400,
      coverage: 1,
      resolution: 64,
    })
    const roadPath = roadEnabled
      ? [
          { x: 0, z: 256, y: 0, heading: 0 },
          { x: 512, z: 256, y: 0, heading: 0 },
        ]
      : []
    const roadField = roadEnabled
      ? buildRoadFieldData(roadPath, {
          minX: grid.minX,
          minZ: grid.minZ,
          sizeX: grid.maxX - grid.minX,
          sizeZ: grid.maxZ - grid.minZ,
          minY: 0,
          maxY: 0,
          maxInfluence: 64,
          maxResolution: 256,
        })
      : null
    return { grid, density, roadField }
  }

  it('produces deterministic tree chunk placements', () => {
    const deps = createDeps(true)
    const baseParams = {
      seed: 99,
      chunkSize: 64,
      densityMultiplier: 1,
      maxSlope: 0.2,
      roadClearance: 2,
      roadHalfWidth: 3.5,
      roadShoulderWidth: 2.5,
      minScale: 4,
      maxScale: 9,
      minHeight: null,
    }
    const coordinates: Array<[number, number]> = []
    for (let chunkX = 0; chunkX < 6; chunkX += 1) {
      for (let chunkZ = 0; chunkZ < 6; chunkZ += 1) {
        coordinates.push([chunkX, chunkZ])
      }
    }
    const first = coordinates.map(([chunkX, chunkZ]) => planTreeChunk({ ...baseParams, chunkX, chunkZ }, deps))
    const second = coordinates.map(([chunkX, chunkZ]) => planTreeChunk({ ...baseParams, chunkX, chunkZ }, deps))
    expect(second).toEqual(first)
    const totalTrees = first.reduce((sum, chunk) => sum + chunk.length, 0)
    expect(totalTrees).toBeGreaterThan(0)
  })

  it('keeps the density tier a stable prefix of the full candidate list', () => {
    const deps = createDeps(true)
    const placements = planTreeChunk(
      {
        seed: 7,
        chunkX: 1,
        chunkZ: 1,
        chunkSize: 64,
        densityMultiplier: 1,
        maxSlope: 0.2,
        roadClearance: 2,
        roadHalfWidth: 3.5,
        roadShoulderWidth: 2.5,
        minScale: 4,
        maxScale: 9,
        minHeight: null,
      },
      deps,
    )
    const low = takeDensityPrefix(placements, 0.4)
    const high = takeDensityPrefix(placements, 1)
    expect(high.length).toBe(placements.length)
    expect(low.length).toBeLessThanOrEqual(high.length)
    expect(low).toEqual(placements.slice(0, low.length))
    expect(takeDensityPrefix(placements, 0)).toEqual([])
  })

  it('places roadside grass inside the corridor and bushes near the road', () => {
    const deps = createDeps(true)
    const result = planRoadBucket(
      {
        seed: 5,
        bucketIndex: 0,
        fromX: 0,
        fromZ: 256,
        toX: 16,
        toZ: 256,
        halfWidth: 3.5,
        shoulderWidth: 2.5,
        corridorWidth: 20,
        grassDensity: 1,
        sinkNearRoad: 1.2,
        bushesEnabled: true,
        bushesDensity: 0.5,
      },
      deps,
    )
    expect(result.grass.length).toBeGreaterThan(0)
    for (const placement of result.grass) {
      const distance = deps.roadField!.distanceAt(placement.x, placement.z)
      expect(distance).toBeGreaterThan(3.5)
      expect(distance).toBeLessThan(3.5 + 20 + 1)
    }
    for (const bush of result.bushes) {
      const distance = deps.roadField!.distanceAt(bush.x, bush.z)
      expect(distance).toBeLessThanOrEqual(3.5 + 4 + 0.5)
    }
  })

  it('keeps camera grass chunks deterministic and off the asphalt', () => {
    const deps = createDeps(true)
    const params = {
      seed: 11,
      chunkX: 30,
      chunkZ: 30,
      chunkSize: 8,
      density: 1,
      maxSlope: 0.7,
      roadHalfWidth: 3.5,
      roadShoulderWidth: 2.5,
    }
    const first = planCameraGrassChunk(params, deps)
    const second = planCameraGrassChunk(params, deps)
    expect(second).toEqual(first)
    for (const placement of first) {
      const distance = deps.roadField!.distanceAt(placement.x, placement.z)
      expect(distance).toBeGreaterThan(3.5)
    }
  })
})

describe('road field encoding', () => {
  it('round-trips distances within the encoding step', () => {
    for (const distance of [0, 0.5, 3.2, 12.7, 47.9, 64]) {
      const decoded = decodeRoadDistance(encodeRoadDistance(distance, 64), 64)
      expect(Math.abs(decoded - distance)).toBeLessThanOrEqual(64 / 255 + 1e-6)
    }
  })

  it('builds a road field and texture for a straight path', () => {
    const path = [
      { x: 0, z: 50, y: 10, heading: 0 },
      { x: 100, z: 50, y: 12, heading: 0 },
    ]
    const field = buildRoadFieldData(path, {
      minX: 0,
      minZ: 0,
      sizeX: 100,
      sizeZ: 100,
      minY: 0,
      maxY: 20,
      maxInfluence: 48,
      maxResolution: 128,
    })
    expect(field).not.toBeNull()
    expect(field!.distanceAt(50, 50)).toBeLessThan(1)
    expect(field!.distanceAt(50, 90)).toBeGreaterThan(30)
    const height = field!.heightAt(50, 50)
    expect(height).not.toBeNull()
    expect(height!).toBeGreaterThan(10.5)
    const texture = createRoadFieldTexture(field!)
    expect(texture.image.width).toBe(field!.width)
    expect(texture.image.height).toBe(field!.height)
    texture.dispose()
  })
})

describe('official surface parity (slowroads.io)', () => {
  it('no longer exposes the custom heather parameters (official formula instead)', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    expect('heatherCoverage' in props.surface).toBe(false)
    expect('heatherStrength' in props.surface).toBe(false)
    expect('heatherStartRatio' in props.surface).toBe(false)
    expect('heatherTransitionRatio' in props.surface).toBe(false)
  })

  it('exposes the official radiance/shadowFactor uniforms with matching defaults', () => {
    const uniforms = createProceduralLandscapeSurfaceUniforms()
    expect(uniforms.uPlRadiance.value).toBe(2)
    expect(uniforms.uPlShadowFactor.value).toBe(1)
  })

  it('injects the official Lambert surface stack (heather formula, radiance composition, ambient shadow)', () => {
    const original = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), original)
    const uniforms = createProceduralLandscapeSurfaceUniforms()
    const patch = applyProceduralLandscapeSurfaceInjection([mesh], uniforms)
    expect(patch.hasInjection).toBe(true)

    // 官方材质族：Lambert（无镜面）。
    const material = mesh.material as unknown as THREE.MeshLambertMaterial
    expect((material as unknown as { isMeshLambertMaterial?: boolean }).isMeshLambertMaterial).toBe(true)

    const parameters = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    } as unknown as Parameters<typeof material.onBeforeCompile>[0]
    material.onBeforeCompile(parameters, { capabilities: { maxTextures: 32 } } as never)

    // 官方 heather 分布公式（与官方地形顶点着色器一致）。
    expect(parameters.fragmentShader).toContain('vFade1 * 350.0')
    expect(parameters.fragmentShader).toContain('plScreen(vFade1, vFade0)')
    // 官方自发光与合成补丁。
    expect(parameters.fragmentShader).toContain('totalEmissiveRadiance = plSeasonalColor * uPlRadiance;')
    expect(parameters.fragmentShader).toContain('reflectedLight.directDiffuse * totalEmissiveRadiance')
    // 官方环境光树影调制。
    expect(parameters.fragmentShader).toContain('plAmbientShadow')
    expect(parameters.fragmentShader).toContain('reflectedLight.indirectDiffuse *= plAmbientShadow;')
    expect(parameters.uniforms.uPlRadiance).toBeTruthy()
    expect(parameters.uniforms.uPlShadowFactor).toBeTruthy()

    patch.restore()
    expect(mesh.material).toBe(original)
  })
})

describe('asset references', () => {
  it('no longer collects procedural landscape asset slots (assets come from the online bundle)', () => {
    const collected: Array<{ assetId: string | null | undefined; path: string }> = []
    visitExplicitComponentAssetReferences(
      PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
      {
        // 旧文档里可能残留的 assets 字段必须被忽略（不做旧场景兼容）。
        assets: { surfaceGrassAssetId: 'grass-surface' },
      },
      (reference) => collected.push(reference),
    )
    expect(collected).toHaveLength(0)
  })
})
