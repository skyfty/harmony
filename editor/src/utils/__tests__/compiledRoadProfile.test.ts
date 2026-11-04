import { describe, expect, it } from 'vitest'
import {
  buildCompiledRoadProfileSourceSignature,
  inspectCompiledRoadProfile,
  inspectCompiledRoadProfileForProps,
} from '@schema/proceduralLandscape/compiledRoadProfile'
import {
  createDefaultProceduralLandscapeProps,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeGeneratedRouteCenterline,
} from '@schema/proceduralLandscape/config'

function createRoadProps(): ProceduralLandscapeComponentProps {
  const props = createDefaultProceduralLandscapeProps({ id: 'terrain-a' })
  props.dem.assetId = 'dem-a'
  props.dem.runtimeGridUrl = 'https://example.test/dem-grid.bin'
  props.dem.runtimeGridBytes = 1024
  props.road.generatedRoute = {
    waypoints: [
      { x: 1, z: 2 },
      { x: 11, z: 2 },
    ],
    strategy: 'seeded',
    termination: 'dead-end',
    style: 'normal',
    seed: props.seed,
    waypointTolerance: 4,
    pathDeviation: 60,
    revision: 3,
    centerline: {
      pointsXZ: [1, 2, 11, 2],
      algorithmVersion: 2,
      authoringSampleStep: 1,
      authoringCellSize: 10,
      exclusionSignature: 'baked-exclusion',
    },
  }
  return props
}

function expectedSignature(props: ProceduralLandscapeComponentProps): string {
  const centerline = props.road.generatedRoute!.centerline!
  return buildCompiledRoadProfileSourceSignature(props, {
    groundSurfaceRevision: 0,
    authoringSampleStep: centerline.authoringSampleStep,
    authoringCellSize: centerline.authoringCellSize,
    exclusionSignature: centerline.exclusionSignature ?? '',
  })
}

function createCenterline(
  sourceSignature: string,
  pointsLocalXYZ = [1, 20, 2, 11, 24, 2],
): ProceduralLandscapeGeneratedRouteCenterline {
  return {
    pointsXZ: [1, 2, 11, 2],
    algorithmVersion: 2,
    authoringSampleStep: 1,
    authoringCellSize: 10,
    exclusionSignature: 'baked-exclusion',
    compiledProfile: {
      sourceSignature,
      pointsLocalXYZ,
    },
  }
}

describe('compiled DEM road profile inspection', () => {
  it('reports a missing centerline or compiled profile explicitly', () => {
    const props = createRoadProps()
    const signature = expectedSignature(props)

    expect(inspectCompiledRoadProfile(undefined, signature)).toEqual({
      status: 'missing-centerline',
      expectedSignature: signature,
      storedSignature: null,
    })

    const centerline = createCenterline(signature)
    delete centerline.compiledProfile
    expect(inspectCompiledRoadProfile(centerline, signature)).toEqual({
      status: 'missing-profile',
      expectedSignature: signature,
      storedSignature: null,
    })
  })

  it('reports malformed height arrays as invalid', () => {
    const props = createRoadProps()
    const signature = expectedSignature(props)
    const centerline = createCenterline(signature, [1, 20, 2])

    expect(inspectCompiledRoadProfile(centerline, signature)).toMatchObject({
      status: 'invalid-profile',
      storedSignature: signature,
    })
  })

  it('reports stale signatures without discarding the stored profile', () => {
    const props = createRoadProps()
    const centerline = createCenterline('old-signature')
    const signature = expectedSignature(props)

    expect(inspectCompiledRoadProfile(centerline, signature)).toEqual({
      status: 'stale-profile',
      expectedSignature: signature,
      storedSignature: 'old-signature',
    })
  })

  it('uses the baked exclusion signature and accepts a matching profile', () => {
    const props = createRoadProps()
    const signature = expectedSignature(props)
    const centerline = createCenterline(signature)

    expect(inspectCompiledRoadProfile(centerline, signature)).toMatchObject({
      status: 'valid',
      storedSignature: signature,
    })
    expect(buildCompiledRoadProfileSourceSignature(props, {
      groundSurfaceRevision: 0,
      authoringSampleStep: centerline.authoringSampleStep,
      authoringCellSize: centerline.authoringCellSize,
      exclusionSignature: centerline.exclusionSignature ?? '',
    })).toBe(signature)
    expect(buildCompiledRoadProfileSourceSignature(props, {
      groundSurfaceRevision: 0,
      authoringSampleStep: centerline.authoringSampleStep,
      authoringCellSize: centerline.authoringCellSize,
      exclusionSignature: 'live-exclusion',
    })).not.toBe(signature)
  })

  it('does not invalidate the committed profile when only the editable draft changes', () => {
    const props = createRoadProps()
    const signature = expectedSignature(props)
    props.road.generatedRoute!.centerline = createCenterline(signature)

    props.road.waypoints = [
      { x: 100, z: 200 },
      { x: 130, z: 240 },
    ]

    expect(inspectCompiledRoadProfileForProps(props, {
      groundSurfaceRevision: 0,
    })).toMatchObject({
      status: 'valid',
      storedSignature: signature,
    })
  })
})
