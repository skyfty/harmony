import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SceneJsonExportDocument, SceneNode, SceneNodeComponentState } from '@schema/core'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import {
  collectProceduralLandscapeTexturePreloadIds,
  collectProceduralLandscapeTexturePreloadRefs,
} from '@schema/proceduralLandscape/preload'
import {
  buildProceduralLandscapeTexturePreload,
  ensureProceduralLandscapeTexturePreload,
} from '@/utils/proceduralLandscapePreload'
import {
  decodeScenePackageSceneDocument,
  encodeScenePackageSceneDocument,
} from '@schema/scenePackageSceneCodec'

const PROCEDURAL_LANDSCAPE_COMPONENT_TYPE = 'proceduralLandscape'

function createLandscapeNode(
  id: string,
  overrides: Partial<NonNullable<ReturnType<typeof createDefaultProceduralLandscapeProps>>> = {},
): SceneNode {
  const props = {
    ...createDefaultProceduralLandscapeProps({ id }),
    ...overrides,
  }
  return {
    id,
    name: id,
    nodeType: 'Mesh',
    visible: true,
    children: [],
    components: {
      [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
        id: `${id}-landscape`,
        type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
        enabled: true,
        props,
      } as SceneNodeComponentState<typeof props>,
    },
  } as unknown as SceneNode
}

function createDocument(nodes: SceneNode[], season: 'spring' | 'summer' | 'autumn' | 'winter'): SceneJsonExportDocument {
  return {
    id: 'scene',
    name: 'Scene',
    createdAt: '',
    updatedAt: '',
    nodes,
    environment: {
      slowroads: {
        season,
        timeOfDay: 'day',
        weather: 'clear',
        showClouds: true,
        showStars: true,
        showSnow: true,
        exposureScale: 1,
      },
      physicsEngine: 'cannon',
      gravityStrength: 9.81,
      collisionRestitution: 0.2,
      collisionFriction: 0.8,
    },
  }
}

describe('procedural landscape texture preload', () => {
  it('collects the current season, enabled layers and shared maps in stable order', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    const refs = collectProceduralLandscapeTexturePreloadRefs(props, 'winter')
    const ids = refs.map((ref) => ref.id)

    expect(ids).toContain('winter_grass.2126ead2')
    expect(ids).toContain('winter_trees_0.99189e5d')
    expect(ids).toContain('winter_bushes.8e9f3165')
    expect(ids).toContain('winter_wall_barrier.2f3faaf6')
    expect(ids).toContain('noise_fine.592be1a0')
    expect(ids).toContain('grass_variation.209068de')
    expect(ids).toContain('rock_bump.8f8c68ad')
    expect(ids).toContain('noise_finer.98c1753c')
    expect(ids).toContain('sea_waves.63ff8729')
    expect(ids).not.toContain('winter_road.e19b36b8')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)))
  })

  it('selects the road style only when a generated route is ready', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.road.width = 7
    props.road.generatedRoute = {
      waypoints: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      style: 'normal',
      seed: 1,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
    }
    expect(collectProceduralLandscapeTexturePreloadIds(props, 'winter'))
      .toContain('winter_road.e19b36b8')

    props.road.width = 1.8
    const narrowIds = collectProceduralLandscapeTexturePreloadIds(props, 'winter')
    expect(narrowIds).toContain('winter_road_single.7e3852c1')
    expect(narrowIds).not.toContain('winter_road.e19b36b8')
  })

  it('returns no textures when every landscape texture consumer is disabled', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.surface.enabled = false
    props.forest.coverage = 0
    props.grass.enabled = false
    props.bushes.enabled = false
    props.road.enabled = false
    props.water.enabled = false
    props.walls.drystone.enabled = false
    props.walls.fence.enabled = false
    props.walls.barrier.enabled = false
    props.walls.seaWall.enabled = false

    expect(collectProceduralLandscapeTexturePreloadIds(props, 'spring')).toEqual([])
  })

  it('resolves every default preload ID from the shipped slowroads asset bundle', () => {
    const manifestPath = fileURLToPath(new URL(
      '../../../../tools/slowroads-lab/assets-src/asset-bundle.json',
      import.meta.url,
    ))
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ logicalId: string; sourceLocalAssetId?: string }>
    }
    const available = new Set(manifest.files.map((file) => file.sourceLocalAssetId ?? file.logicalId))
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const ids = collectProceduralLandscapeTexturePreloadIds(
        createDefaultProceduralLandscapeProps({ id: 'terrain' }),
        season,
      )
      expect(ids.filter((id) => !available.has(id) && !available.has(`${id}@2048`))).toEqual([])

      for (const width of [7, 1.8]) {
        const props = createDefaultProceduralLandscapeProps({ id: `road-${width}` })
        props.road.width = width
        props.road.generatedRoute = {
          waypoints: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
          strategy: 'seeded',
          termination: 'boundary',
          style: 'normal',
          seed: 1,
          waypointTolerance: 4,
          pathDeviation: 60,
          revision: 1,
        }
        const roadIds = collectProceduralLandscapeTexturePreloadIds(props, season)
        expect(roadIds.filter((id) => !available.has(id) && !available.has(`${id}@2048`))).toEqual([])
      }
    }
  })
})

describe('scene document landscape preload metadata', () => {
  it('merges visible enabled landscapes and ignores hidden or disabled nodes', () => {
    const surfaceNode = createLandscapeNode('surface-node')
    const grassNode = createLandscapeNode('grass-node')
    grassNode.components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!.props = {
      ...grassNode.components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!.props,
      surface: {
        ...grassNode.components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!.props.surface,
        enabled: false,
      },
    }
    const hiddenNode = createLandscapeNode('hidden-node')
    hiddenNode.visible = false
    const disabledNode = createLandscapeNode('disabled-node')
    disabledNode.components![PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]!.enabled = false

    const preload = buildProceduralLandscapeTexturePreload(
      createDocument([surfaceNode, grassNode, hiddenNode, disabledNode], 'autumn'),
    )
    expect(preload?.season).toBe('autumn')
    expect(preload?.textureIds).toContain('autumn_trees_0.2fe560b0')
    expect(preload?.textureIds).toContain('summer_grasses.7ddf683f')
    expect(preload?.textureIds).not.toContain('spring_trees_0.aee94219')
  })

  it('creates a texture-only preload block and survives the scene package codec', () => {
    const document = createDocument([createLandscapeNode('terrain')], 'summer')
    ensureProceduralLandscapeTexturePreload(document)

    expect(document.assetPreload?.mesh).toEqual({ all: [] })
    expect(document.assetPreload?.slowroadsTextures?.season).toBe('summer')
    expect(document.assetPreload?.slowroadsTextures?.textureIds.length).toBeGreaterThan(0)

    const decoded = decodeScenePackageSceneDocument(encodeScenePackageSceneDocument(document))
    expect(decoded.assetPreload?.slowroadsTextures).toEqual(
      document.assetPreload?.slowroadsTextures,
    )
  })

  it('preserves existing mesh preload metadata', () => {
    const document = createDocument([createLandscapeNode('terrain')], 'spring')
    document.assetPreload = {
      mesh: {
        all: ['mesh-a'],
        essential: ['mesh-a'],
      },
    }
    ensureProceduralLandscapeTexturePreload(document)

    expect(document.assetPreload.mesh).toEqual({
      all: ['mesh-a'],
      essential: ['mesh-a'],
    })
    expect(document.assetPreload.slowroadsTextures?.season).toBe('spring')
  })

  it('does not create landscape preload metadata without an enabled landscape component', () => {
    const document = createDocument([], 'spring')
    expect(ensureProceduralLandscapeTexturePreload(document)).toBeUndefined()
    expect(document.assetPreload?.slowroadsTextures).toBeUndefined()
  })

  it('ignores landscape nodes inside a hidden subtree', () => {
    const hiddenParent = {
      id: 'hidden-parent',
      name: 'Hidden parent',
      nodeType: 'Group',
      visible: false,
      children: [createLandscapeNode('hidden-child')],
    } as unknown as SceneNode
    const document = createDocument([hiddenParent], 'spring')
    expect(buildProceduralLandscapeTexturePreload(document)).toBeUndefined()
  })
})
