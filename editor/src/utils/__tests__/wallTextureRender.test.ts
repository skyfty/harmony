import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  WALL_COMPONENT_TYPE,
  clampWallProps,
  resolveWallComponentPropsFromMesh,
  type WallCornerModelRule,
} from '@schema/components'
import { createWallRenderGroup, type WallTextureResource } from '@schema/wallMesh'
import {
  buildWallDynamicMeshFromWorldSegments,
  buildWallUpdateRenderOptions,
} from '@/stores/wallUtils'
import { shouldPreserveTextureWallNodeMaterials } from '@schema/wallRenderMode'
import {
  BUILTIN_AIR_WALL_PRESET,
  collectWallPresetDependencyAssetIds,
  parseWallPresetData,
} from '@/stores/wallPresetActions'
import { WALL_PRESET_FORMAT_VERSION } from '@/utils/wallPreset'
import { buildWallMesh } from '@schema/sceneGraph/dynamicMeshes/wall'
import { collectSceneNodeDependencyAssetIds } from '@/utils/sceneAssetCollectors'

function makeTextureResource(width = 2, height = 1): WallTextureResource {
  const texture = new THREE.Texture()
  texture.image = { width, height }
  texture.needsUpdate = true
  return { texture, width, height }
}

function makeCornerRule(overrides: Partial<WallCornerModelRule> = {}): WallCornerModelRule {
  return {
    bodyAssetId: null,
    headAssetId: null,
    footAssetId: null,
    bodyTextureAssetId: null,
    headTextureAssetId: null,
    footTextureAssetId: null,
    bodyOffsetLocal: { x: 0, y: 0, z: 0 },
    headOffsetLocal: { x: 0, y: 0, z: 0 },
    footOffsetLocal: { x: 0, y: 0, z: 0 },
    bodyForwardAxis: '+z',
    bodyYawDeg: 0,
    headForwardAxis: '+z',
    headYawDeg: 0,
    footForwardAxis: '+z',
    footYawDeg: 0,
    angle: 90,
    tolerance: 5,
    jointTrim: { start: 0.5, end: 0.5 },
    ...overrides,
  }
}

function buildStraightWall(length = 6) {
  const built = buildWallDynamicMeshFromWorldSegments(
    [{ start: { x: 0, y: 0, z: 0 }, end: { x: length, y: 0, z: 0 } }],
    { height: 3, width: 0.2, thickness: 0.2 },
  )
  if (!built) {
    throw new Error('Failed to build wall fixture')
  }
  return built.definition
}

describe('wall texture rendering', () => {
  it('preserves texture mode and migrates missing texture ids to null', () => {
    const base = resolveWallComponentPropsFromMesh(buildStraightWall())
    const props = clampWallProps({
      ...base,
      wallRenderMode: 'texture',
      bodyTextureAssetId: undefined,
      headTextureAssetId: undefined,
      footTextureAssetId: undefined,
    })

    expect(props.wallRenderMode).toBe('texture')
    expect(props.bodyTextureAssetId).toBeNull()
    expect(props.postTextureAssetId).toBeNull()
    expect(props.postSpacingMeters).toBe(4)
    expect(props.headTextureAssetId).toBeNull()
    expect(props.footTextureAssetId).toBeNull()
  })

  it('keeps texture settings when wall dimensions rebuild the runtime group', () => {
    const base = resolveWallComponentPropsFromMesh(buildStraightWall())
    const options = buildWallUpdateRenderOptions({
      ...base,
      wallRenderMode: 'texture',
      bodyTextureAssetId: 'body-image',
      headTextureAssetId: 'head-image',
      footTextureAssetId: 'foot-image',
      postTextureAssetId: 'post-image',
      postSpacingMeters: 3.5,
      headAssetHeight: 0.4,
      footAssetHeight: 0.2,
    })

    expect(options.wallRenderMode).toBe('texture')
    expect(options.bodyTextureAssetId).toBe('body-image')
    expect(options.headTextureAssetId).toBe('head-image')
    expect(options.footTextureAssetId).toBe('foot-image')
    expect(options.postTextureAssetId).toBe('post-image')
    expect(options.postSpacingMeters).toBe(3.5)
    expect(options.headAssetHeight).toBe(0.4)
    expect(options.footAssetHeight).toBe(0.2)
  })

  it('creates an alpha-tested double-sided body sheet without a procedural box', () => {
    const definition = buildStraightWall()
    const baselineY = Number(definition.chains[0]?.points[0]?.y ?? 0)
    const group = createWallRenderGroup(
      definition,
      { texturesByAssetId: { body: makeTextureResource() } },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
      },
    )
    const meshes: THREE.Mesh[] = []
    group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        meshes.push(object as THREE.Mesh)
      }
    })

    expect(meshes).toHaveLength(1)
    const material = meshes[0]!.material as THREE.MeshLambertMaterial
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial)
    expect(material.alphaTest).toBe(0.5)
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.side).toBe(THREE.DoubleSide)
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace)

    meshes[0]!.geometry.computeBoundingBox()
    expect(meshes[0]!.geometry.boundingBox?.min.y).toBeCloseTo(baselineY)
    expect(meshes[0]!.geometry.boundingBox?.max.y).toBeCloseTo(baselineY + 3)
  })

  it('keeps the existing procedural wall path for model render modes', () => {
    const group = createWallRenderGroup(buildStraightWall(), {}, { wallRenderMode: 'stretch' })
    const meshes = group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)
    expect(meshes).toHaveLength(1)
    expect(meshes[0]!.name).toBe('WallMesh')
    expect(meshes[0]!.material).toBeInstanceOf(THREE.MeshStandardMaterial)
  })

  it('places body, head and foot in non-overlapping height bands', () => {
    const definition = buildStraightWall()
    const baselineY = Number(definition.chains[0]?.points[0]?.y ?? 0)
    const group = createWallRenderGroup(
      definition,
      {
        texturesByAssetId: {
          body: makeTextureResource(),
          head: makeTextureResource(),
          foot: makeTextureResource(),
        },
      },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
        headTextureAssetId: 'head',
        footTextureAssetId: 'foot',
        headAssetHeight: 1,
        footAssetHeight: 0.5,
      },
    )
    const bounds = new Map<string, THREE.Box3>()
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) {
        return
      }
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      if (box) {
        bounds.set(String(mesh.userData.wallTexturePart), box)
      }
    })

    expect(bounds.get('foot')?.min.y).toBeCloseTo(baselineY)
    expect(bounds.get('foot')?.max.y).toBeCloseTo(baselineY + 0.5)
    expect(bounds.get('body')?.min.y).toBeCloseTo(baselineY + 0.5)
    expect(bounds.get('body')?.max.y).toBeCloseTo(baselineY + 2)
    expect(bounds.get('head')?.min.y).toBeCloseTo(baselineY + 2)
    expect(bounds.get('head')?.max.y).toBeCloseTo(baselineY + 3)
  })

  it('creates equal bays with full-height posts and one Body panel per bay', () => {
    const group = createWallRenderGroup(
      buildStraightWall(12),
      {
        texturesByAssetId: {
          body: makeTextureResource(1, 1),
          post: makeTextureResource(1, 4),
        },
      },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
        postTextureAssetId: 'post',
        postSpacingMeters: 4,
      },
    )
    const meshes = group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)
    const postMesh = meshes.find((mesh) => mesh.userData.wallTexturePart === 'post')
    const bodyMesh = meshes.find((mesh) => mesh.userData.wallTexturePart === 'body')

    expect(postMesh?.geometry.getIndex()?.count).toBe(24)
    expect(bodyMesh?.geometry.getIndex()?.count).toBe(18)
    expect(postMesh).toBeDefined()
    postMesh!.geometry.computeBoundingBox()
    expect(postMesh!.geometry.boundingBox?.max.y).toBeCloseTo(
      Number(postMesh!.geometry.boundingBox?.min.y) + 3,
    )
  })

  it('places posts at both sides of an opening and ignores sub-5-degree polyline noise', () => {
    const opened = buildStraightWall(12)
    opened.openings = [{ chainIndex: 0, start: 5, end: 7 }]
    const openedGroup = createWallRenderGroup(
      opened,
      {
        texturesByAssetId: {
          body: makeTextureResource(1, 1),
          post: makeTextureResource(1, 20),
        },
      },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
        postTextureAssetId: 'post',
        postSpacingMeters: 4,
      },
    )
    const openedPost = openedGroup.children.find(
      (child): child is THREE.Mesh =>
        (child as THREE.Mesh).isMesh && child.userData.wallTexturePart === 'post',
    )
    expect(openedPost?.geometry.getIndex()?.count).toBe(36)

    const buildTurnedWall = (degrees: number) => {
      const radians = THREE.MathUtils.degToRad(degrees)
      return buildWallDynamicMeshFromWorldSegments(
        [
          { start: { x: 0, y: 0, z: 0 }, end: { x: 6, y: 0, z: 0 } },
          {
            start: { x: 6, y: 0, z: 0 },
            end: { x: 6 + Math.cos(radians) * 6, y: 0, z: Math.sin(radians) * 6 },
          },
        ],
        { height: 3, width: 0.2, thickness: 0.2 },
      )!.definition
    }
    const postCount = (definition: ReturnType<typeof buildStraightWall>) => {
      const group = createWallRenderGroup(
        definition,
        { texturesByAssetId: { post: makeTextureResource(1, 20) } },
        {
          wallRenderMode: 'texture',
          postTextureAssetId: 'post',
          postSpacingMeters: 100,
        },
      )
      const mesh = group.children.find(
        (child): child is THREE.Mesh =>
          (child as THREE.Mesh).isMesh && child.userData.wallTexturePart === 'post',
      )
      return mesh?.geometry.getIndex()?.count ?? 0
    }
    expect(postCount(buildTurnedWall(3))).toBe(12)
    // The corner post spans the bend and is represented by one quad on each
    // side of the joint.
    expect(postCount(buildTurnedWall(10))).toBe(24)
  })

  it('replaces the configured joint interval with a bent corner texture', () => {
    const built = buildWallDynamicMeshFromWorldSegments(
      [
        { start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } },
        { start: { x: 5, y: 0, z: 0 }, end: { x: 5, y: 0, z: 5 } },
      ],
      { height: 3, width: 0.2, thickness: 0.2 },
    )
    if (!built) {
      throw new Error('Failed to build corner fixture')
    }
    const assets = { texturesByAssetId: { body: makeTextureResource(1, 1) } }
    const straightGroup = createWallRenderGroup(built.definition, assets, {
      wallRenderMode: 'texture',
      bodyTextureAssetId: 'body',
    })
    const cornerGroup = createWallRenderGroup(built.definition, assets, {
      wallRenderMode: 'texture',
      bodyTextureAssetId: 'body',
      cornerModels: [makeCornerRule({ bodyTextureAssetId: 'body' })],
    })

    const straightMesh = straightGroup.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)!
    const cornerMesh = cornerGroup.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)!
    expect(straightMesh.geometry.getIndex()?.count).toBe(12)
    expect(cornerMesh.geometry.getIndex()?.count).toBe(24)
  })

  it('auto-fits a zero-trim corner texture from its aspect ratio', () => {
    const built = buildWallDynamicMeshFromWorldSegments(
      [
        { start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } },
        { start: { x: 5, y: 0, z: 0 }, end: { x: 5, y: 0, z: 5 } },
      ],
      { height: 3, width: 0.2, thickness: 0.2 },
    )
    if (!built) {
      throw new Error('Failed to build corner fixture')
    }
    const group = createWallRenderGroup(
      built.definition,
      { texturesByAssetId: { body: makeTextureResource(1, 1) } },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
        cornerModels: [makeCornerRule({
          bodyTextureAssetId: 'body',
          jointTrim: { start: 0, end: 0 },
        })],
      },
    )
    const mesh = group.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh)!
    expect(mesh.geometry.getIndex()?.count).toBe(24)
  })

  it('uses a specialized corner texture instead of a duplicate generic post', () => {
    const built = buildWallDynamicMeshFromWorldSegments(
      [
        { start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } },
        { start: { x: 5, y: 0, z: 0 }, end: { x: 5, y: 0, z: 5 } },
      ],
      { height: 3, width: 0.2, thickness: 0.2 },
    )
    if (!built) {
      throw new Error('Failed to build corner fixture')
    }
    const group = createWallRenderGroup(
      built.definition,
      {
        texturesByAssetId: {
          body: makeTextureResource(1, 1),
          corner: makeTextureResource(1, 1),
          post: makeTextureResource(1, 4),
        },
      },
      {
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body',
        postTextureAssetId: 'post',
        postSpacingMeters: 100,
        cornerModels: [makeCornerRule({ bodyTextureAssetId: 'corner' })],
      },
    )
    const postMesh = group.children.find(
      (child): child is THREE.Mesh =>
        (child as THREE.Mesh).isMesh && child.userData.wallTexturePart === 'post',
    )

    // Only the two open-wall ends receive generic posts. The matching 90°
    // corner is replaced by its specialized corner texture.
    expect(postMesh?.geometry.getIndex()?.count).toBe(12)
  })

  it('reads version 9 presets and preserves texture settings in the current version', () => {
    const legacyProps = JSON.parse(JSON.stringify(BUILTIN_AIR_WALL_PRESET.wallProps))
    delete legacyProps.bodyTextureAssetId
    delete legacyProps.headTextureAssetId
    delete legacyProps.footTextureAssetId
    for (const corner of legacyProps.cornerModels) {
      delete corner.bodyTextureAssetId
      delete corner.headTextureAssetId
      delete corner.footTextureAssetId
    }
    const legacy = parseWallPresetData(JSON.stringify({
      kind: 'wall-preset',
      formatVersion: 9,
      name: 'Legacy',
      wallProps: legacyProps,
      materialOrder: [],
      materialPatches: {},
    }))
    expect(legacy.formatVersion).toBe(WALL_PRESET_FORMAT_VERSION)
    expect(legacy.wallProps.bodyTextureAssetId).toBeNull()
    expect(legacy.wallProps.postTextureAssetId).toBeNull()
    expect(legacy.wallProps.postSpacingMeters).toBe(4)

    const current = parseWallPresetData(JSON.stringify({
      ...BUILTIN_AIR_WALL_PRESET,
      name: 'Texture',
      wallProps: {
        ...BUILTIN_AIR_WALL_PRESET.wallProps,
        wallRenderMode: 'texture',
        bodyTextureAssetId: 'body-image',
        headTextureAssetId: 'head-image',
        footTextureAssetId: 'foot-image',
        postTextureAssetId: 'post-image',
        postSpacingMeters: 3.5,
      },
    }))
    expect(current.wallProps.wallRenderMode).toBe('texture')
    expect(current.wallProps.bodyTextureAssetId).toBe('body-image')
    expect(current.wallProps.headTextureAssetId).toBe('head-image')
    expect(current.wallProps.footTextureAssetId).toBe('foot-image')
    expect(current.wallProps.postTextureAssetId).toBe('post-image')
    expect(current.wallProps.postSpacingMeters).toBe(3.5)
    expect(collectWallPresetDependencyAssetIds(current)).toEqual(
      expect.arrayContaining(['body-image', 'head-image', 'foot-image']),
    )
  })

  it('includes the Post image in Preview scene asset dependencies', () => {
    const dependencies = collectSceneNodeDependencyAssetIds([{
      id: 'wall-preview-dependency',
      name: 'Wall',
      nodeType: 'Mesh',
      components: {
        wall: {
          id: 'wall',
          type: 'wall',
          enabled: true,
          props: {
            wallRenderMode: 'texture',
            postTextureAssetId: 'a.png',
          },
        },
      },
    } as any])

    expect(dependencies.has('a.png')).toBe(true)
  })

  it('does not load model assets when building a texture-mode wall', async () => {
    const definition = buildStraightWall()
    const baseProps = resolveWallComponentPropsFromMesh(definition)
    const loadAssetMesh = vi.fn(async () => {
      throw new Error('model loading must not run in texture mode')
    })
    const result = await buildWallMesh(
      {
        loadAssetMesh,
        loadWallTexture: async () => makeTextureResource(),
        resolveNodeMaterials: async () => [],
        pickMaterialAssignment: () => null,
        applyTransform: () => {},
        applyVisibility: () => {},
      },
      definition,
      {
        id: 'wall-texture-test',
        name: 'Wall',
        nodeType: 'Mesh',
        dynamicMesh: definition,
        components: {
          wall: {
            id: 'wall',
            type: 'wall',
            enabled: true,
            props: {
              ...baseProps,
              wallRenderMode: 'texture',
              bodyTextureAssetId: 'body',
              postTextureAssetId: 'post',
            },
          },
        },
      } as any,
    )

    expect(result).toBeInstanceOf(THREE.Group)
    expect(loadAssetMesh).not.toHaveBeenCalled()
    const meshes: THREE.Mesh[] = []
    result?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        meshes.push(object as THREE.Mesh)
      }
    })
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.some((mesh) => mesh.userData.wallTexturePart === 'post')).toBe(true)
  })

  it('protects texture wall materials from generic runtime material overrides', () => {
    const makeNode = (wallRenderMode: string, enabled = true) => ({
      dynamicMesh: { type: 'Wall' },
      components: {
        [WALL_COMPONENT_TYPE]: {
          enabled,
          props: { wallRenderMode },
        },
      },
    }) as any

    expect(shouldPreserveTextureWallNodeMaterials(makeNode('texture'))).toBe(true)
    expect(shouldPreserveTextureWallNodeMaterials(makeNode('stretch'))).toBe(false)
    expect(shouldPreserveTextureWallNodeMaterials(makeNode('texture', false))).toBe(false)
    expect(shouldPreserveTextureWallNodeMaterials({
      dynamicMesh: { type: 'Floor' },
      components: {
        [WALL_COMPONENT_TYPE]: {
          enabled: true,
          props: { wallRenderMode: 'texture' },
        },
      },
    } as any)).toBe(false)
  })
})
