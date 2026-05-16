import assert from 'node:assert/strict'

import * as THREE from 'three'

import { buildRoadHeightfieldBodies } from '../dist/roadHeightfield.js'
import { collectRoadHeightfieldTileDescriptors } from '../dist/roadHeightfield.js'
import { buildRoadHeightfieldShapes } from '../dist/roadHeightfieldShapes.js'
import { createRoadComponentState, ROAD_COMPONENT_TYPE } from '../dist/components/definitions/roadComponent.js'
import { clampRigidbodyComponentProps, RIGIDBODY_COMPONENT_TYPE } from '../dist/components/definitions/rigidbodyComponent.js'

function createFlatHeightMap(rows, columns, fill = 0) {
  return new Array(Math.max(0, (rows + 1) * (columns + 1))).fill(fill)
}

function createRoadNode({
  id,
  vertices,
  segmentHeights,
  collisionSubdivisionFactor = 1,
  enableVehicleCollision = true,
  samplingDensityFactor = 1.25,
  smoothingStrengthFactor = 1.1,
  minClearance = 0.04,
}) {
  const roadNode = {
    id,
    name: id,
    nodeType: 'Empty',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    dynamicMesh: {
      type: 'Road',
      width: 3,
      vertices,
      segments: vertices.slice(0, -1).map((_value, index) => ({ a: index, b: index + 1 })),
      segmentHeights,
    },
    components: {},
  }

  const roadComponent = createRoadComponentState(roadNode, {
    width: 3,
    snapToTerrain: true,
    enableVehicleCollision,
    laneLines: false,
    shoulders: false,
    junctionSmoothing: 0.35,
    samplingDensityFactor,
    collisionSubdivisionFactor,
    smoothingStrengthFactor,
    minClearance,
  })
  const rigidbodyComponent = {
    id: `${id}:rigidbody`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      mass: 0,
      targetNodeId: id,
    }),
  }

  roadNode.components = {
    [ROAD_COMPONENT_TYPE]: roadComponent,
    [RIGIDBODY_COMPONENT_TYPE]: rigidbodyComponent,
  }

  return {
    roadNode,
    roadComponent,
    rigidbodyComponent,
  }
}

function createGroundNode(id, sampleHeight) {
  return {
    id,
    name: id,
    nodeType: 'Empty',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    dynamicMesh: {
      type: 'Ground',
      terrainMode: 'bounded',
      width: 64,
      depth: 64,
      rows: 6,
      columns: 6,
      cellSize: 10,
      baseHeight: 0,
      manualHeightMap: createFlatHeightMap(6, 6),
      planningHeightMap: createFlatHeightMap(6, 6),
      planningMetadata: null,
      castShadow: false,
      terrainScatterInstancesUpdatedAt: 0,
      terrainPaint: null,
      groundSurfaceChunks: null,
      optimizedMesh: null,
      localEditTiles: null,
      surfaceRevision: 0,
      runtimeTerrainHeightSampler: {
        sampleHeightAtWorld(x, z) {
          return sampleHeight(x, z)
        },
      },
    },
    components: {},
  }
}

function assertBoxOnly(items, label) {
  assert.ok(items.length > 0, `${label} should produce at least one collision segment`)
  assert.equal(items.every((item) => item === 'box'), true, `${label} should only emit box shapes`)
}

function maxAdjacentPitchDelta(tiles) {
  let maxDelta = 0
  for (let index = 1; index < tiles.length; index += 1) {
    const prev = Number.isFinite(tiles[index - 1]?.pitch) ? tiles[index - 1].pitch : 0
    const next = Number.isFinite(tiles[index]?.pitch) ? tiles[index].pitch : 0
    const delta = Math.abs(next - prev)
    if (delta > maxDelta) {
      maxDelta = delta
    }
  }
  return maxDelta
}

function makeWavySampleHeight(x, z) {
  return Math.sin(x * 0.12) * 0.28 + Math.cos(z * 0.16) * 0.18
}

function makeFlatSampleHeight() {
  return 0
}

async function main() {
  const flatVertices = [
    [0, 0],
    [10, 0],
    [20, 0],
    [30, 0],
  ]
  const wavyVertices = [
    [0, 0],
    [10, 0],
    [20, 6],
    [30, 6],
  ]

  const flatRoad = createRoadNode({
    id: 'road:flat',
    vertices: flatVertices,
    segmentHeights: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const wavyRoad = createRoadNode({
    id: 'road:wavy',
    vertices: wavyVertices,
    segmentHeights: [
      [0, 0.12, 0.3, 0.48],
      [0.48, 0.92, 0.35, 1.05],
      [1.05, 0.84, 0.52, 0.18],
    ],
  })
  const flatGround = createGroundNode('ground:flat', makeFlatSampleHeight)
  const wavyGround = createGroundNode('ground:wavy', makeWavySampleHeight)

  const flatSnapshot = collectRoadHeightfieldTileDescriptors({
    roadNode: flatRoad.roadNode,
    rigidbodyComponent: flatRoad.rigidbodyComponent,
  })
  assert.ok(flatSnapshot, 'flat road should build collision data')
  assertBoxOnly(flatSnapshot.tiles.map((tile) => tile.shapeDefinition.kind), 'flat road runtime collision')
  assert.equal(flatSnapshot.tiles.every((tile) => Math.abs(tile.pitch) < 1e-4), true, 'flat road boxes should stay level')

  const lowDetailRoad = createRoadNode({
    id: 'road:low-detail',
    vertices: wavyVertices,
    segmentHeights: wavyRoad.roadNode.dynamicMesh.segmentHeights,
    collisionSubdivisionFactor: 0.5,
  })
  const highDetailRoad = createRoadNode({
    id: 'road:high-detail',
    vertices: wavyVertices,
    segmentHeights: wavyRoad.roadNode.dynamicMesh.segmentHeights,
    collisionSubdivisionFactor: 3.5,
  })

  const lowDetailSnapshot = collectRoadHeightfieldTileDescriptors({
    roadNode: lowDetailRoad.roadNode,
    rigidbodyComponent: lowDetailRoad.rigidbodyComponent,
  })
  const highDetailSnapshot = collectRoadHeightfieldTileDescriptors({
    roadNode: highDetailRoad.roadNode,
    rigidbodyComponent: highDetailRoad.rigidbodyComponent,
  })
  assert.ok(lowDetailSnapshot, 'low detail road should build collision data')
  assert.ok(highDetailSnapshot, 'high detail road should build collision data')
  assertBoxOnly(lowDetailSnapshot.tiles.map((tile) => tile.shapeDefinition.kind), 'low detail road runtime collision')
  assertBoxOnly(highDetailSnapshot.tiles.map((tile) => tile.shapeDefinition.kind), 'high detail road runtime collision')
  assert.ok(
    highDetailSnapshot.tiles.length > lowDetailSnapshot.tiles.length,
    `higher collisionSubdivisionFactor should produce more boxes (${highDetailSnapshot.tiles.length} > ${lowDetailSnapshot.tiles.length})`,
  )

  const pitchedRoad = createRoadNode({
    id: 'road:pitch',
    vertices: [
      [0, 0],
      [12, 0],
      [24, 0],
      [36, 0],
    ],
    segmentHeights: [
      [0, 0.2, 0.45, 0.72],
      [0.72, 1.08, 1.34, 1.7],
      [1.7, 1.52, 1.26, 1.02],
    ],
  })
  const pitchedSnapshot = collectRoadHeightfieldTileDescriptors({
    roadNode: pitchedRoad.roadNode,
    rigidbodyComponent: pitchedRoad.rigidbodyComponent,
  })
  assert.ok(pitchedSnapshot, 'pitched road should build tile descriptors')
  assert.ok(
    pitchedSnapshot.tiles.some((tile) => Math.abs(tile.pitch) > 0.01),
    'pitched road boxes should receive a non-zero pitch',
  )
  assert.ok(
    maxAdjacentPitchDelta(pitchedSnapshot.tiles) <= 0.18,
    `pitched road boxes should keep adjacent pitch transitions small (${maxAdjacentPitchDelta(pitchedSnapshot.tiles)})`,
  )
  const bodyRotations = []
  const bodyHeights = []
  const pitchedBodies = buildRoadHeightfieldBodies({
    roadNode: pitchedRoad.roadNode,
    rigidbodyComponent: pitchedRoad.rigidbodyComponent,
    roadObject: new THREE.Group(),
    createBody: (_node, _component, shapeDefinition, object) => {
      if (shapeDefinition) {
        assert.equal(shapeDefinition.kind, 'box', 'pitched road bodies should use box shapes')
      }
      bodyRotations.push([object.rotation.x, object.rotation.y, object.rotation.z])
      bodyHeights.push(object.position.y)
      return {
        body: { name: 'stub-body' },
        orientationAdjustment: null,
      }
    },
  })
  assert.ok(pitchedBodies, 'pitched road should build rigidbody collision data')
  assert.ok(
    bodyRotations.some(([x]) => Math.abs(x) > 0.01),
    'pitched road boxes should apply a non-zero pitch',
  )
  assert.ok(
    bodyHeights.some((value) => Math.abs(value) > 0.01),
    'pitched road boxes should be placed along the sampled road height',
  )

  const shapesSnapshot = buildRoadHeightfieldShapes({
    roadNode: wavyRoad.roadNode,
    groundNode: wavyGround,
    maxSegments: 64,
  })
  assert.ok(shapesSnapshot, 'road shape export should build')
  assertBoxOnly(shapesSnapshot.segments.map((segment) => segment.shape.kind), 'road shape export')
  assert.ok(
    shapesSnapshot.segments.some((segment) => Math.abs(segment.transform.position[1]) > 0.01),
    'road shape export should place boxes along terrain height',
  )

  const disabledRoad = createRoadNode({
    id: 'road:disabled',
    vertices: wavyVertices,
    segmentHeights: wavyRoad.roadNode.dynamicMesh.segmentHeights,
    enableVehicleCollision: false,
  })
  assert.equal(
    collectRoadHeightfieldTileDescriptors({
      roadNode: disabledRoad.roadNode,
      rigidbodyComponent: disabledRoad.rigidbodyComponent,
    }),
    null,
    'disabled road collision should not build tile descriptors',
  )
  assert.equal(
    buildRoadHeightfieldBodies({
      roadNode: disabledRoad.roadNode,
      rigidbodyComponent: disabledRoad.rigidbodyComponent,
      roadObject: new THREE.Group(),
      createBody: () => ({
        body: { name: 'stub-body' },
        orientationAdjustment: null,
      }),
    }),
    null,
    'disabled road collision should not build rigidbody bodies',
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
