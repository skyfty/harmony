import { describe, expect, it } from 'vitest'
import {
  DEVICE_ADAPTATION_COMPONENT_TYPE,
  GUIDE_ROUTE_COMPONENT_TYPE,
} from '@schema/components'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components/definitions/proceduralLandscapeComponent'
import { LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE } from '@schema/components/definitions/landscapeExclusionZoneComponent'
import { createDefaultProceduralLandscapeProps } from '@schema/proceduralLandscape/config'
import { buildCompiledRoadProfileSourceSignature } from '@schema/proceduralLandscape/compiledRoadProfile'
import {
  buildSceneAssetReferenceSummaryMap,
  collectSceneAssetReferenceRecords,
  validateSceneAssetReferences,
} from '../sceneAssetDiagnostics'

function createScene(nodes: unknown[]) {
  return {
    id: 'scene-1',
    name: 'Scene',
    nodes,
    environment: {},
    groundSettings: {},
    assetCatalog: {},
    assetRegistry: {},
  } as unknown as Parameters<typeof validateSceneAssetReferences>[0]
}

function createNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    name: 'Node',
    children: [],
    components: {},
    ...overrides,
  }
}

describe('scene asset diagnostics', () => {
  it('blocks export when a DEM road centerline has no compiled height profile', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'ground-1' })
    props.dem.assetId = 'dem-asset'
    props.dem.runtimeGridUrl = 'https://example.test/dem-grid.bin'
    props.road.generatedRoute = {
      waypoints: [{ x: 0, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      style: 'normal',
      seed: 1,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
      centerline: {
        pointsXZ: [0, 0, 10, 0],
        algorithmVersion: 2,
        authoringSampleStep: 1,
        authoringCellSize: 30,
      },
    }
    const report = validateSceneAssetReferences(createScene([
      createNode({
        id: 'ground-1',
        dynamicMesh: { type: 'Ground', surfaceRevision: 0 },
        components: {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            id: 'landscape-component',
            type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
            enabled: true,
            props,
          },
        },
      }),
    ]), {})

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'procedural-landscape-road-profile',
    }))
  })

  it('keeps a committed DEM road valid after the landscape draft seed changes', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'ground-1' })
    props.dem.assetId = 'dem-asset'
    props.dem.runtimeGridUrl = 'https://example.test/dem-grid.bin'
    props.seed = 11
    props.road.generatedRoute = {
      waypoints: [{ x: 0, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      style: 'normal',
      seed: 11,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
      centerline: {
        pointsXZ: [0, 0, 10, 0],
        algorithmVersion: 2,
        authoringSampleStep: 1,
        authoringCellSize: 30,
        exclusionSignature: '',
      },
    }
    props.road.generatedRoute.centerline!.compiledProfile = {
      sourceSignature: buildCompiledRoadProfileSourceSignature(props, {
        groundSurfaceRevision: 0,
        authoringSampleStep: 1,
        authoringCellSize: 30,
        exclusionSignature: '',
      }),
      pointsLocalXYZ: [0, 20, 0, 10, 20, 0],
    }
    props.seed = 99

    const report = validateSceneAssetReferences(createScene([
      createNode({
        id: 'ground-1',
        name: '青龙山',
        components: {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            id: 'landscape-component',
            type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
            enabled: true,
            props,
          },
        },
      }),
    ]), {})

    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'procedural-landscape-road-profile',
    }))
  })

  it('invalidates the compiled road profile when an exclusion zone changes', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'ground-1' })
    props.dem.assetId = 'dem-asset'
    props.dem.runtimeGridUrl = 'https://example.test/dem-grid.bin'
    props.road.generatedRoute = {
      waypoints: [{ x: 0, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      style: 'normal',
      seed: 1,
      waypointTolerance: 4,
      pathDeviation: 60,
      revision: 1,
      centerline: {
        pointsXZ: [0, 0, 10, 0],
        algorithmVersion: 2,
        authoringSampleStep: 1,
        authoringCellSize: 30,
        exclusionSignature: '',
        compiledProfile: {
          sourceSignature: buildCompiledRoadProfileSourceSignature(props, {
            groundSurfaceRevision: 0,
            authoringSampleStep: 1,
            authoringCellSize: 30,
            exclusionSignature: '',
          }),
          pointsLocalXYZ: [0, 20, 0, 10, 20, 0],
        },
      },
    }
    const scene = createScene([
      createNode({
        id: 'ground-1',
        name: '青龙山',
        dynamicMesh: { type: 'Ground', surfaceRevision: 0 },
        components: {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            id: 'landscape-component',
            type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
            enabled: true,
            props,
          },
          [LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE]: {
            id: 'exclusion-component',
            type: LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE,
            enabled: true,
            props: { radius: 20 },
          },
        },
      }),
    ])

    const report = validateSceneAssetReferences(scene, {})
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'procedural-landscape-road-profile',
    }))
  })

  it('does not treat a device-adaptation profile ID as an asset reference', () => {
    const scene = createScene([createNode({
      components: {
        [DEVICE_ADAPTATION_COMPONENT_TYPE]: {
          id: 'component-1',
          type: DEVICE_ADAPTATION_COMPONENT_TYPE,
          enabled: true,
          props: { rules: [{ profileId: 'builtin-android', action: 'hide' }] },
        },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})
    const summary = buildSceneAssetReferenceSummaryMap(scene)

    expect(references.some((reference) => reference.assetId === 'builtin-android')).toBe(false)
    expect(report.issues.some((issue) => issue.assetId === 'builtin-android')).toBe(false)
    expect(summary.has('builtin-android')).toBe(false)
  })

  it('continues to validate model assets configured by a device-adaptation rule', () => {
    const scene = createScene([createNode({
      components: {
        [DEVICE_ADAPTATION_COMPONENT_TYPE]: {
          id: 'component-1',
          type: DEVICE_ADAPTATION_COMPONENT_TYPE,
          enabled: true,
          props: {
            rules: [{ profileId: 'builtin-android', action: 'replaceModel', modelAssetId: 'missing-model' }],
          },
        },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})

    expect(references).toContainEqual(expect.objectContaining({
      assetId: 'missing-model',
      path: expect.stringContaining('rules[0].modelAssetId'),
      category: 'component',
    }))
    expect(report.issues).toContainEqual(expect.objectContaining({
      assetId: 'missing-model',
      code: 'missing-catalog-entry',
    }))
  })

  it('continues to treat terrain-scatter profile IDs as asset references', () => {
    const scene = createScene([createNode({
      dynamicMesh: {
        type: 'Ground',
        terrainScatter: { layers: [{ profileId: 'scatter-asset' }] },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})

    expect(references.some((reference) => reference.assetId === 'scatter-asset')).toBe(true)
    expect(report.issues).toContainEqual(expect.objectContaining({
      assetId: 'scatter-asset',
      code: 'missing-catalog-entry',
    }))
  })

  it('treats Guide Route waypoint thumbnails as runtime asset references', () => {
    const scene = createScene([createNode({
      dynamicMesh: { type: 'GuideRoute', vertices: [] },
      components: {
        [GUIDE_ROUTE_COMPONENT_TYPE]: {
          id: 'guide-route-component',
          type: GUIDE_ROUTE_COMPONENT_TYPE,
          enabled: true,
          props: {
            loop: false,
            legs: [
              {
                id: 'path-1',
                kind: 'path',
                travelMode: 'character',
                speedProfile: {
                  cruiseSpeedMps: 1.4,
                  lateralAccelLimitMps2: 2.5,
                },
                surfaceProviderNodeId: null,
                preserveAuthoredY: true,
                anchors: [
                  { x: 0, y: 0, z: 0 },
                  { x: 10, y: 0, z: 0 },
                ],
              },
            ],
            stops: [
              {
                id: 'stop-1',
                name: 'P1',
                anchor: { x: 0, y: 0, z: 0 },
                legId: 'path-1',
                behavior: null,
                thumbnailAssetId: 'waypoint-thumbnail',
              },
            ],
            transitions: [],
          },
        },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    expect(references).toContainEqual(expect.objectContaining({
      assetId: 'waypoint-thumbnail',
      path: expect.stringContaining('stops[0].thumbnailAssetId'),
    }))
  })
})
