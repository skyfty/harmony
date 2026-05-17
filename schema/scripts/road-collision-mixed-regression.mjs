import assert from 'node:assert/strict'

import * as THREE from 'three'

import { buildRoadCollisionBodies, collectRoadCollisionDescriptors } from '../dist/roadCollision.js'
import { createRoadComponentState, ROAD_COMPONENT_TYPE } from '../dist/components/definitions/roadComponent.js'
import { clampRigidbodyComponentProps, RIGIDBODY_COMPONENT_TYPE } from '../dist/components/definitions/rigidbodyComponent.js'

function createRoadNode({
  id,
  vertices,
  segments,
  segmentHeights,
  collisionSubdivisionFactor = 1,
  enableVehicleCollision = true,
  samplingDensityFactor = 1.25,
  smoothingStrengthFactor = 1.1,
  minClearance = 0.04,
  junctionSmoothing = 0.35,
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
      segments: segments ?? vertices.slice(0, -1).map((_value, index) => ({ a: index, b: index + 1 })),
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
    junctionSmoothing,
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
    rigidbodyComponent,
  }
}

function assertShapeKinds(snapshot, expectedKind, label) {
  assert.ok(snapshot, `${label} should build collision data`)
  assert.ok(snapshot.descriptors.length > 0, `${label} should emit at least one descriptor`)
  assert.equal(
    snapshot.descriptors.every((entry) => entry.shapeDefinition.kind === expectedKind),
    true,
    `${label} should only emit ${expectedKind} shapes`,
  )
}

async function main() {
  const flatRoad = createRoadNode({
    id: 'road:flat',
    vertices: [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ],
    segmentHeights: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  })
  const flatSnapshot = collectRoadCollisionDescriptors(flatRoad)
  assertShapeKinds(flatSnapshot, 'box', 'flat road')

  const lowDetailRoad = createRoadNode({
    id: 'road:low-detail',
    vertices: [
      [0, 0],
      [20, 0],
      [40, 0],
      [60, 0],
    ],
    segmentHeights: [
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    collisionSubdivisionFactor: 0.5,
  })
  const highDetailRoad = createRoadNode({
    id: 'road:high-detail',
    vertices: [
      [0, 0],
      [20, 0],
      [40, 0],
      [60, 0],
    ],
    segmentHeights: [
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    collisionSubdivisionFactor: 3.5,
  })
  const lowDetailSnapshot = collectRoadCollisionDescriptors(lowDetailRoad)
  const highDetailSnapshot = collectRoadCollisionDescriptors(highDetailRoad)
  assertShapeKinds(lowDetailSnapshot, 'box', 'low detail flat road')
  assertShapeKinds(highDetailSnapshot, 'box', 'high detail flat road')
  assert.ok(
    highDetailSnapshot.descriptors.length > lowDetailSnapshot.descriptors.length,
    `higher collisionSubdivisionFactor should produce more boxes (${highDetailSnapshot.descriptors.length} > ${lowDetailSnapshot.descriptors.length})`,
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
  const pitchedSnapshot = collectRoadCollisionDescriptors(pitchedRoad)
  assertShapeKinds(pitchedSnapshot, 'static-mesh', 'pitched road')

  const crossingRoad = createRoadNode({
    id: 'road:crossing',
    vertices: [
      [0, 0],
      [10, 0],
      [5, -5],
      [5, 5],
    ],
    segments: [
      { a: 0, b: 1 },
      { a: 2, b: 3 },
    ],
    segmentHeights: [
      [0, 0.8, 1.6, 2.4],
      [0, 0, 0, 0],
    ],
  })
  const crossingSnapshot = collectRoadCollisionDescriptors(crossingRoad)
  assert.ok(crossingSnapshot, 'crossing road should build collision data')
  assert.ok(
    crossingSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'static-mesh'),
    'crossing road should emit static-mesh collision for complex elevated geometry',
  )
  assert.equal(
    crossingSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'heightfield'),
    false,
    'road collision descriptors must never emit heightfield shapes',
  )

  const bodyKinds = []
  const builtBodies = buildRoadCollisionBodies({
    ...pitchedRoad,
    roadObject: new THREE.Group(),
    createBody: (_node, _component, shapeDefinition) => {
      bodyKinds.push(shapeDefinition?.kind ?? null)
      return {
        body: { name: 'stub-body' },
        orientationAdjustment: null,
      }
    },
  })
  assert.ok(builtBodies, 'pitched road should build rigidbody collision bodies')
  assert.ok(bodyKinds.includes('static-mesh'), 'pitched road runtime bodies should use static-mesh shapes')

  const disabledRoad = createRoadNode({
    id: 'road:disabled',
    vertices: [
      [0, 0],
      [12, 0],
      [24, 0],
    ],
    segmentHeights: [
      [0, 0.2, 0.5, 0.8],
      [0.8, 1.0, 0.9, 0.7],
    ],
    enableVehicleCollision: false,
  })
  assert.equal(
    collectRoadCollisionDescriptors(disabledRoad),
    null,
    'disabled road collision should not build descriptors',
  )
  assert.equal(
    buildRoadCollisionBodies({
      ...disabledRoad,
      roadObject: new THREE.Group(),
      createBody: () => {
        throw new Error('disabled road collision should not create bodies')
      },
    }),
    null,
    'disabled road collision should not build rigidbody bodies',
  )

  console.log('road-collision-mixed-regression: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
