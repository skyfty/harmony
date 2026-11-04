import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  FloorDynamicMesh,
  RegionDynamicMesh,
  SceneNode,
  WallDynamicMesh,
} from '@schema/core'
import { Component, type ComponentRuntimeContext } from '@schema/components/Component'
import {
  ComponentManager,
  type ComponentDefinition,
} from '@schema/components/componentManager'
import {
  TERRAIN_FLATTENING_COMPONENT_TYPE,
  createTerrainFlatteningComponentState,
  terrainFlatteningComponentDefinition,
} from '@schema/components'
import {
  TERRAIN_FLATTENING_FLOOR_CLEARANCE,
  TERRAIN_FLATTENING_TERRAIN_CLEARANCE,
  buildLandscapeTerrainFlatteningOwnerSnapshot,
  clampTerrainFlatteningComponentProps,
  clipRoadbedGeometryInsideFloorFlattening,
  collectTerrainFlatteningRoadProbes,
  collectTerrainFlatteningSamplePoints,
  createDemTerrainFlatteningGeometry,
  createDemTerrainFlatteningTarget,
  findNearestTerrainFlatteningRoadConnection,
  getLandscapeTerrainFlatteningSnapshot,
  isTerrainFlatteningPointCleared,
  registerLandscapeTerrainFlattening,
  resetLandscapeTerrainFlatteningForTests,
  resolveTerrainFlatteningOwnerReferenceWorldY,
  selectDemTerrainFlatteningTargetAt,
  terrainFlatteningTriangleIntersectsCore,
  terrainFlatteningTriangleIntersectsInfluence,
  type TerrainFlatteningComponentProps,
} from '@schema/proceduralLandscape/terrainFlattening'
import {
  createDemTerrainHeightGrid,
  createDemTerrainMeshBuilder,
  sampleDemTerrainCollisionHeightAt,
  sampleVisibleDemSurfaceHeightAt,
  splitDemTerrainGeometry,
} from '@schema/proceduralLandscape/demTerrain'
import { normalizeNodeComponents } from '@/stores/normalizeNodeComponentsUtils'

class NodeContextProbe extends Component<Record<string, never>> {
  constructor(context: ComponentRuntimeContext<Record<string, never>>) {
    super(context)
  }

  onUpdate(): void {
    nodeContextValue = this.context.getNode()?.position?.y ?? null
  }
}

let nodeContextValue: number | null = null

const nodeContextProbeDefinition: ComponentDefinition<Record<string, never>> = {
  type: 'terrain-flattening-node-probe',
  label: 'Node probe',
  canAttach: () => true,
  createDefaultProps: () => ({}),
  createInstance: (context: ComponentRuntimeContext<Record<string, never>>) => (
    new NodeContextProbe(context)
  ),
}

const PROPS: TerrainFlatteningComponentProps = {
  heightMode: 'owner',
  manualHeight: 0,
  edgeMode: 'slope',
  edgeBlendWidth: 8,
  corridorWidth: 4,
  autoClearVegetation: true,
}

function makeTransform(position = { x: 0, y: 0, z: 0 }) {
  return {
    position,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
}

function makeFloorNode(position = { x: 0, y: 40, z: 0 }): SceneNode {
  const dynamicMesh: FloorDynamicMesh = {
    type: 'Floor',
    vertices: [[-10, -10], [10, -10], [10, 10], [-10, 10]],
    thickness: 2,
    smooth: 0,
    sideUvScale: { x: 1, y: 1 },
  }
  return {
    id: 'floor-node',
    name: 'Floor',
    nodeType: 'Mesh',
    ...makeTransform(position),
    dynamicMesh,
    components: {},
  } as SceneNode
}

function makeRegionNode(position = { x: 0, y: 30, z: 0 }): SceneNode {
  const dynamicMesh: RegionDynamicMesh = {
    type: 'Region',
    vertices: [[-10, -10], [10, -10], [10, 10], [-10, 10]],
  }
  return {
    id: 'region-node',
    name: 'Region',
    nodeType: 'Mesh',
    ...makeTransform(position),
    dynamicMesh,
    components: {},
  } as SceneNode
}

function makeWallNode(position = { x: 0, y: 20, z: 0 }): SceneNode {
  const dynamicMesh: WallDynamicMesh = {
    type: 'Wall',
    chains: [{
      points: [
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      closed: false,
    }],
    openings: [],
    dimensions: { height: 2, width: 1, thickness: 0.5 },
  }
  return {
    id: 'wall-node',
    name: 'Wall',
    nodeType: 'Mesh',
    ...makeTransform(position),
    dynamicMesh,
    components: {},
  } as SceneNode
}

function makeObject(node: SceneNode): THREE.Group {
  const object = new THREE.Group()
  object.position.set(node.position!.x, node.position!.y, node.position!.z)
  object.rotation.set(node.rotation!.x, node.rotation!.y, node.rotation!.z)
  object.scale.set(node.scale!.x, node.scale!.y, node.scale!.z)
  object.updateMatrixWorld(true)
  return object
}

function snapshotFor(node: SceneNode, props: Partial<TerrainFlatteningComponentProps> = {}) {
  return buildLandscapeTerrainFlatteningOwnerSnapshot({
    id: `${node.id}:component`,
    node,
    object: makeObject(node),
    props: { ...PROPS, ...props },
    componentId: 'component',
  })
}

function makeGridData(): Parameters<typeof createDemTerrainHeightGrid>[0] {
  const size = 7
  const heights = new Float32Array(size * size)
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      heights[row * size + column] = 30 + column * 2 + row
    }
  }
  return {
    width: size,
    height: size,
    minX: 0,
    maxX: 60,
    minZ: 0,
    maxZ: 60,
    cellSizeX: 10,
    cellSizeZ: 10,
    minElevation: 30,
    maxElevation: 47,
    sourceMinElevation: 30,
    sourceMaxElevation: 47,
    anchor: {
      latitudeDegrees: 0,
      longitudeDegrees: 0,
      groundElevationMeters: 0,
    },
    crs: { epsg: 32650, zone: 50, hemisphere: 'north' },
    filledRatio: 1,
    heights,
  }
}

describe('terrain flattening component', () => {
  beforeEach(() => resetLandscapeTerrainFlatteningForTests())

  it('clamps props and only attaches to Floor, Region and Wall', () => {
    expect(clampTerrainFlatteningComponentProps({
      heightMode: 'manual',
      manualHeight: 12,
      edgeMode: 'wall',
      edgeBlendWidth: 0,
      corridorWidth: 1000,
      autoClearVegetation: false,
    })).toMatchObject({
      heightMode: 'manual',
      manualHeight: 12,
      edgeMode: 'wall',
      edgeBlendWidth: 0.25,
      corridorWidth: 200,
      autoClearVegetation: false,
    })
    expect(terrainFlatteningComponentDefinition.canAttach(makeFloorNode())).toBe(true)
    expect(terrainFlatteningComponentDefinition.canAttach(makeRegionNode())).toBe(true)
    expect(terrainFlatteningComponentDefinition.canAttach(makeWallNode())).toBe(true)
    expect(terrainFlatteningComponentDefinition.canAttach({
      ...makeFloorNode(),
      dynamicMesh: { type: 'Ground' },
    } as SceneNode)).toBe(false)
    const state = createTerrainFlatteningComponentState(makeWallNode())
    expect(state.type).toBe(TERRAIN_FLATTENING_COMPONENT_TYPE)
    expect(state.props.corridorWidth).toBeGreaterThanOrEqual(4)
  })

  it('updates the component context node between manager syncs', () => {
    const manager = new ComponentManager()
    manager.registerDefinition(nodeContextProbeDefinition)
    const first = makeRegionNode({ x: 0, y: 10, z: 0 })
    first.components = {
      probe: {
        id: 'probe',
        type: 'terrain-flattening-node-probe',
        enabled: true,
        props: {},
      },
    }
    manager.syncScene([first])
    manager.update(0.016)
    expect(nodeContextValue).toBe(10)

    const next = { ...first, position: { x: 0, y: 25, z: 0 } }
    manager.syncScene([next])
    manager.update(0.016)
    expect(nodeContextValue).toBe(25)
  })

  it('registers, follows and removes the terrain target with the component lifecycle', () => {
    resetLandscapeTerrainFlatteningForTests()
    const manager = new ComponentManager()
    manager.registerDefinition(terrainFlatteningComponentDefinition)
    const node = makeRegionNode({ x: 20, y: 35, z: 10 })
    node.components = {
      [TERRAIN_FLATTENING_COMPONENT_TYPE]: createTerrainFlatteningComponentState(node, {
        heightMode: 'owner',
      }, {
        id: 'flattening',
      }),
    }
    const object = makeObject(node)
    manager.attachRuntime(node, object)
    expect(getLandscapeTerrainFlatteningSnapshot().targets).toHaveLength(1)
    expect(getLandscapeTerrainFlatteningSnapshot().targets[0]?.targetY).toBe(35)

    node.position = { x: 20, y: 41, z: 10 }
    node.components![TERRAIN_FLATTENING_COMPONENT_TYPE]!.enabled = true
    node.components![TERRAIN_FLATTENING_COMPONENT_TYPE]!.props = {
      ...node.components![TERRAIN_FLATTENING_COMPONENT_TYPE]!.props,
      heightMode: 'owner',
    }
    object.position.y = 41
    object.updateMatrixWorld(true)
    manager.syncNode(node)
    expect(getLandscapeTerrainFlatteningSnapshot().targets[0]?.targetY).toBe(41)

    delete node.components![TERRAIN_FLATTENING_COMPONENT_TYPE]
    manager.syncNode(node)
    expect(getLandscapeTerrainFlatteningSnapshot().targets).toHaveLength(0)
  })

  it('resolves owner reference heights for all supported node types', () => {
    const floor = makeFloorNode()
    const region = makeRegionNode()
    const wall = makeWallNode()
    expect(resolveTerrainFlatteningOwnerReferenceWorldY(floor, makeObject(floor))).toBe(42)
    expect(resolveTerrainFlatteningOwnerReferenceWorldY(region, makeObject(region))).toBe(30)
    expect(resolveTerrainFlatteningOwnerReferenceWorldY(wall, makeObject(wall))).toBe(20)
  })

  it('builds polygon footprints and world-scaled Wall corridors', () => {
    const floor = snapshotFor(makeFloorNode()).snapshot!
    const region = snapshotFor(makeRegionNode()).snapshot!
    const wallNode = makeWallNode()
    wallNode.scale = { x: 2, y: 1, z: 1 }
    const wall = snapshotFor(wallNode).snapshot!
    expect(floor.footprint.kind).toBe('polygon')
    expect(region.footprint.kind).toBe('polygon')
    expect(wall.footprint.kind).toBe('corridor')
    if (wall.footprint.kind === 'corridor') {
      expect(wall.footprint.halfWidth).toBe(2)
      expect(wall.footprint.chains[0]!.pointsWorldXZ[1]![0]).toBe(20)
    }
  })

  it('follows a tilted Floor plane without letting terrain cover it', () => {
    const floor = makeFloorNode()
    floor.rotation = { x: 0.2, y: 0, z: 0 }
    const result = snapshotFor(floor)
    expect(result.warningCode).toBeNull()
    const target = createDemTerrainFlatteningTarget(result.snapshot!)
    expect(target.snapshot.surfacePlane).not.toBeNull()
    expect(target.visibleHeightAt(-8, 0, 500)).toBeCloseTo(target.surfaceHeightAt(-8, 0))
    expect(target.heightAt(8, 0, 500)).toBeLessThan(target.surfaceHeightAt(8, 0))

    const region = makeRegionNode()
    const object = makeObject(region)
    object.visible = false
    const hidden = buildLandscapeTerrainFlatteningOwnerSnapshot({
      id: 'hidden',
      node: region,
      object,
      props: PROPS,
    })
    expect(hidden.warningCode).toBe('owner-not-visible')
  })

  it('migrates legacy Floor terrainPlatform settings to the new component', () => {
    const floor = makeFloorNode()
    ;(floor as any).components = {
      floor: {
        id: 'floor-component',
        type: 'floor',
        enabled: true,
        props: {
          smooth: 0,
          thickness: 2,
          sideUvScale: { x: 1, y: 1 },
          terrainPlatform: {
            enabled: true,
            edgeMode: 'wall',
            edgeBlendWidth: 5,
            autoClearVegetation: false,
          },
        },
      },
    }
    const normalized = normalizeNodeComponents(floor, (floor as any).components)
    expect((normalized?.floor?.props as any).terrainPlatform).toBeUndefined()
    expect(normalized?.[TERRAIN_FLATTENING_COMPONENT_TYPE]?.props).toMatchObject({
      heightMode: 'owner',
      edgeMode: 'wall',
      edgeBlendWidth: 5,
      autoClearVegetation: false,
    })
  })
})

describe('terrain flattening targets', () => {
  beforeEach(() => resetLandscapeTerrainFlatteningForTests())

  it('moves generated collision below a static Rigidbody owner surface', () => {
    const floor = makeFloorNode()
    const withoutRigidbody = snapshotFor(floor).snapshot!
    floor.components = {
      rigidbody: {
        id: 'floor-rigidbody',
        type: 'rigidbody',
        enabled: true,
        props: {
          bodyType: 'STATIC',
        },
      },
    } as any

    const withRigidbody = snapshotFor(floor).snapshot!
    const target = createDemTerrainFlatteningTarget(withRigidbody)
    expect(withRigidbody.collisionAuthority).toBe('rigidbody')
    expect(withRigidbody.signature).not.toBe(withoutRigidbody.signature)
    expect(target.visibleHeightAt(0, 0, 80)).toBe(42)
    expect(target.collisionHeightAt(0, 0, 80)).toBeCloseTo(
      42 - TERRAIN_FLATTENING_FLOOR_CLEARANCE,
      5,
    )
    const grid = createDemTerrainHeightGrid(makeGridData())
    expect(sampleVisibleDemSurfaceHeightAt(grid, null, 0, 0, [target])).toBe(42)
    expect(sampleDemTerrainCollisionHeightAt(grid, null, 0, 0, [target])).toBeCloseTo(
      42 - TERRAIN_FLATTENING_FLOOR_CLEARANCE,
      5,
    )
    const roadbed = {
      distanceAt: () => 0,
      walkableHeightAt: () => 99,
      meshHalfWidth: 3,
    } as any
    expect(sampleDemTerrainCollisionHeightAt(grid, roadbed, 0, 0, [target])).toBeCloseTo(
      42 - TERRAIN_FLATTENING_FLOOR_CLEARANCE,
      5,
    )
    expect(sampleDemTerrainCollisionHeightAt(grid, roadbed, 30, 0, [target])).toBe(99)

    const rigidbody = (floor.components as any).rigidbody
    rigidbody.enabled = false
    const disabledTarget = createDemTerrainFlatteningTarget(snapshotFor(floor).snapshot!)
    expect(disabledTarget.snapshot.collisionAuthority).toBe('generated-terrain')
    expect(disabledTarget.collisionHeightAt(0, 0, 80)).toBe(42)

    rigidbody.enabled = true
    rigidbody.props.bodyType = 'DYNAMIC'
    const dynamicTarget = createDemTerrainFlatteningTarget(snapshotFor(floor).snapshot!)
    expect(dynamicTarget.snapshot.collisionAuthority).toBe('generated-terrain')

    rigidbody.props.bodyType = 'KINEMATIC'
    const kinematicTarget = createDemTerrainFlatteningTarget(snapshotFor(floor).snapshot!)
    expect(kinematicTarget.snapshot.collisionAuthority).toBe('generated-terrain')
  })

  it('flattens polygon interiors and transitions toward raw terrain', () => {
    const snapshot = snapshotFor(makeFloorNode()).snapshot!
    const target = createDemTerrainFlatteningTarget(snapshot)
    expect(target.visibleHeightAt(0, 0, 80)).toBe(42)
    expect(target.heightAt(0, 0, 80)).toBeCloseTo(42 - TERRAIN_FLATTENING_FLOOR_CLEARANCE)
    expect(target.heightAt(14, 0, 80)).toBeGreaterThan(target.gradeY)
    expect(target.heightAt(14, 0, 80)).toBeLessThan(80)
    expect(target.heightAt(30, 0, 80)).toBe(80)
  })

  it('keeps the coarse DEM outside the complete authored transition band', () => {
    const target = createDemTerrainFlatteningTarget(snapshotFor(makeFloorNode()).snapshot!)
    expect(terrainFlatteningTriangleIntersectsCore(
      target,
      10.5,
      0,
      12,
      0,
      11,
      1,
    )).toBe(false)
    expect(terrainFlatteningTriangleIntersectsInfluence(
      target,
      10.5,
      0,
      12,
      0,
      11,
      1,
    )).toBe(true)
    expect(terrainFlatteningTriangleIntersectsInfluence(
      target,
      20,
      0,
      22,
      0,
      21,
      1,
    )).toBe(false)
  })

  it('makes Region terrain itself visible and leaves a Wall corridor flat', () => {
    const region = createDemTerrainFlatteningTarget(snapshotFor(makeRegionNode()).snapshot!)
    expect(region.surfaceY).toBeCloseTo(30 - TERRAIN_FLATTENING_TERRAIN_CLEARANCE)
    expect(region.visibleHeightAt(0, 0, 80)).toBeCloseTo(region.gradeY)

    const wallNode = makeWallNode()
    const wallSnapshot = snapshotFor(wallNode).snapshot!
    registerLandscapeTerrainFlattening({
      id: 'wall:component',
      ownerNodeId: wallNode.id,
      componentId: 'component',
      resolveNode: () => wallNode,
      object: makeObject(wallNode),
      props: PROPS,
    })
    const target = createDemTerrainFlatteningTarget(wallSnapshot)
    expect(target.visibleHeightAt(0, 1.5, 80)).toBeCloseTo(target.gradeY)
    expect(target.heightAt(0, 3, 80)).toBeGreaterThan(target.gradeY)
    expect(target.heightAt(0, 30, 80)).toBe(80)
  })

  it('selects the highest target, clears vegetation and reports overlaps', () => {
    const lower = createDemTerrainFlatteningTarget(snapshotFor(makeFloorNode({ x: 0, y: 40, z: 0 })).snapshot!)
    const higher = createDemTerrainFlatteningTarget(snapshotFor(makeFloorNode({ x: 0, y: 50, z: 0 })).snapshot!)
    expect(selectDemTerrainFlatteningTargetAt([lower, higher], 0, 0)?.id).toContain('floor-node')
    expect(selectDemTerrainFlatteningTargetAt([lower, higher], 0, 0)?.targetY).toBe(52)
    expect(isTerrainFlatteningPointCleared([higher], 11.5, 0, 2)).toBe(true)

    const node = makeFloorNode()
    registerLandscapeTerrainFlattening({
      id: 'a:component',
      ownerNodeId: node.id,
      componentId: 'a',
      resolveNode: () => node,
      object: makeObject(node),
      props: PROPS,
    })
    registerLandscapeTerrainFlattening({
      id: 'b:component',
      ownerNodeId: 'other-floor',
      componentId: 'b',
      resolveNode: () => ({ ...node, id: 'other-floor' }),
      object: makeObject(node),
      props: PROPS,
    })
    expect(getLandscapeTerrainFlatteningSnapshot().warnings.some(
      (warning) => warning.code === 'overlapping-targets',
    )).toBe(true)
  })

  it('provides generic terrain and road sampling points', () => {
    const region = snapshotFor(makeRegionNode()).snapshot!
    const wall = snapshotFor(makeWallNode()).snapshot!
    expect(collectTerrainFlatteningSamplePoints(region.footprint).length).toBeGreaterThan(10)
    expect(collectTerrainFlatteningRoadProbes(wall.footprint).length).toBeGreaterThan(2)
    const connection = findNearestTerrainFlatteningRoadConnection([
      { x: 0, y: 41, z: 0 },
      { x: 10, y: 43, z: 0 },
    ], 4, 3, 0.05)
    expect(connection?.y).toBeCloseTo(41.85)
    expect(connection?.distance).toBeCloseTo(3)
  })

  it('creates visible ground for Region and Wall corridor geometry', () => {
    const regionTarget = createDemTerrainFlatteningTarget(snapshotFor(makeRegionNode()).snapshot!)
    const regionGeometry = createDemTerrainFlatteningGeometry(regionTarget, {
      rawHeightAt: () => 20,
      hostInverse: new THREE.Matrix4(),
      ringCount: 5,
      maxSegmentLength: 2,
    })
    expect(regionGeometry?.triangleCount).toBeGreaterThan(20)

    const wallTarget = createDemTerrainFlatteningTarget(snapshotFor(makeWallNode()).snapshot!)
    const wallGeometry = createDemTerrainFlatteningGeometry(wallTarget, {
      rawHeightAt: () => 10,
      hostInverse: new THREE.Matrix4(),
      maxSegmentLength: 2,
    })
    expect(wallGeometry?.triangleCount).toBeGreaterThan(20)
    const position = wallGeometry!.geometry.getAttribute('position')
    let atCorridorHeight = 0
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getY(index) - wallTarget.gradeY) < 1e-4) {
        atCorridorHeight += 1
      }
    }
    expect(atCorridorHeight).toBeGreaterThan(4)
  })

  it('keeps polygon transition geometry closed beneath roadbed priority', () => {
    const target = createDemTerrainFlatteningTarget(snapshotFor(makeFloorNode()).snapshot!)
    const withoutRoadbed = createDemTerrainFlatteningGeometry(target, {
      rawHeightAt: () => 30,
      hostInverse: new THREE.Matrix4(),
      ringCount: 5,
      maxSegmentLength: 2,
    })
    const withRoadbed = createDemTerrainFlatteningGeometry(target, {
      rawHeightAt: () => 30,
      hostInverse: new THREE.Matrix4(),
      ringCount: 5,
      maxSegmentLength: 2,
      roadbed: {
        distanceAt: () => 0,
        meshHalfWidth: 25,
      },
    })
    expect(withRoadbed?.triangleCount).toBe(withoutRoadbed?.triangleCount)
  })

  it('bakes flattening into the DEM mesh while roadbed remains priority', () => {
    const regionNode = makeRegionNode({ x: 30, y: 60, z: 30 })
    const snapshot = snapshotFor(regionNode).snapshot!
    const target = createDemTerrainFlatteningTarget(snapshot)
    const grid = createDemTerrainHeightGrid(makeGridData())
    const roadbed = {
      meshHalfWidth: 3,
      influenceHalfWidth: 3,
      distanceAt: (x: number) => Math.abs(x - 30),
      coarseHeightAt: () => 70,
      walkableHeightAt: () => 70.05,
    } as any
    expect(sampleVisibleDemSurfaceHeightAt(grid, roadbed, 30, 30, [target])).toBeCloseTo(70.05)
    expect(sampleVisibleDemSurfaceHeightAt(grid, null, 30, 30, [target]))
      .toBeCloseTo(target.surfaceY)

    const builder = createDemTerrainMeshBuilder(makeGridData(), 1, {
      flattenTargets: [target],
      worldOffset: { x: 0, y: 0, z: 0 },
    })
    while (!builder.step(100)) {
      // Time-sliced mesh build.
    }
    const centerIndex = Math.floor(builder.rows / 2) * builder.columns + Math.floor(builder.columns / 2)
    expect(builder.geometry!.getAttribute('position').getY(centerIndex))
      .toBeCloseTo(target.gradeY, 1)
  })

  it('rejects coarse DEM triangles that cross a concave flattening footprint', () => {
    const node = makeFloorNode()
    node.dynamicMesh = {
      type: 'Floor',
      vertices: [
        [-3, -12],
        [3, -12],
        [3, 12],
        [1, 12],
        [1, -4],
        [-1, -4],
        [-1, 12],
        [-3, 12],
      ],
      thickness: 0,
      smooth: 0,
      sideUvScale: { x: 1, y: 1 },
    }
    const target = createDemTerrainFlatteningTarget(snapshotFor(node).snapshot!)
    expect(terrainFlatteningTriangleIntersectsCore(
      target,
      -15,
      -15,
      15,
      -15,
      -15,
      15,
    )).toBe(true)

    const columns = 3
    const rows = 3
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -20, 50, -20,
      0, 50, -20,
      20, 50, -20,
      -20, 50, 0,
      0, 50, 0,
      20, 50, 0,
      -20, 50, 20,
      0, 50, 20,
      20, 50, 20,
    ], 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
      new Array(columns * rows).fill(0).flatMap(() => [0, 1, 0]),
      3,
    ))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 0.5, 0, 1, 0,
      0, 0.5, 0.5, 0.5, 1, 0.5,
      0, 1, 0.5, 1, 1, 1,
    ], 2))
    const chunks = splitDemTerrainGeometry(geometry, columns, rows, 2, {
      flattenTargets: [target],
    })
    expect(chunks.length).toBeLessThan(4)
    expect(chunks.reduce((total, chunk) => total + chunk.triangleCount, 0)).toBeLessThan(8)
    chunks.forEach((chunk) => chunk.geometry.dispose())
    geometry.dispose()
  })

  it('clips roadbed shoulders from an opaque Floor footprint', () => {
    const snapshot = snapshotFor(makeFloorNode()).snapshot!
    const target = createDemTerrainFlatteningTarget(snapshot)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -20, 42, 9,
      20, 42, 9,
      0, 42, 20,
      100, 42, 100,
      101, 42, 100,
      100, 42, 101,
    ], 3))
    const clipped = clipRoadbedGeometryInsideFloorFlattening(
      geometry,
      new THREE.Matrix4(),
      [target],
    )
    expect(clipped.removedTriangleCount).toBe(1)
    expect(clipped.remainingTriangleCount).toBe(1)
    expect(clipped.geometry.getAttribute('position').count).toBe(6)
  })
})
