import assert from 'node:assert/strict'

import * as THREE from 'three'

import { buildRoadCollisionBodies, collectRoadCollisionDescriptors } from '../dist/roadCollision.js'
import { createRoadComponentState, ROAD_COMPONENT_TYPE } from '../dist/components/definitions/roadComponent.js'
import { clampRigidbodyComponentProps, RIGIDBODY_COMPONENT_TYPE } from '../dist/components/definitions/rigidbodyComponent.js'
import {
  buildRoadCollisionCompiledManifestPath,
  buildRoadCollisionCompiledPackagePath,
  deserializeRoadCollisionCompiledManifest,
  deserializeRoadCollisionCompiledPackage,
  ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
  ROAD_COLLISION_COMPILED_PACKAGE_VERSION,
  serializeRoadCollisionCompiledManifest,
  serializeRoadCollisionCompiledPackage,
} from '../dist/index.js'

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

  const gentleSlopeRoad = createRoadNode({
    id: 'road:gentle-slope',
    vertices: [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ],
    segmentHeights: [
      [0, 0.05, 0.1, 0.15],
      [0.15, 0.2, 0.25, 0.3],
      [0.3, 0.35, 0.4, 0.45],
    ],
  })
  const gentleSlopeSnapshot = collectRoadCollisionDescriptors(gentleSlopeRoad)
  assertShapeKinds(gentleSlopeSnapshot, 'box', 'gentle slope road')
  assert.ok(
    gentleSlopeSnapshot.descriptors.some((entry) => Math.abs(entry.pitch) > 1e-4),
    'gentle slope road box spans should carry a visible pitch',
  )

  const flatRoadWithoutHeights = createRoadNode({
    id: 'road:flat-no-heights',
    vertices: [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ],
    segmentHeights: undefined,
  })
  const flatNoHeightsSnapshot = collectRoadCollisionDescriptors(flatRoadWithoutHeights)
  assertShapeKinds(flatNoHeightsSnapshot, 'box', 'flat road without explicit heights')

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

  const complexRoad = createRoadNode({
    id: 'road:complex',
    vertices: [
      [0, 0],
      [12, 0],
      [20, 6],
      [28, -4],
      [40, 0],
    ],
    segmentHeights: [
      [0, 0, 0, 0],
      [0, 0.7, 1.6, 2.4],
      [2.4, 2.0, 1.1, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
  })
  const complexSnapshot = collectRoadCollisionDescriptors(complexRoad)
  assert.ok(complexSnapshot, 'complex road should build collision data')
  assert.ok(
    complexSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'static-mesh'),
    'complex road should emit static-mesh collision for the curved spans',
  )

  const wideRangeRoad = createRoadNode({
    id: 'road:wide-range',
    vertices: [
      [0, 0],
      [18, 0],
      [36, 8],
      [54, -10],
      [72, 12],
      [90, 0],
    ],
    segmentHeights: [
      [0, 0.2, 0.5, 0.7],
      [0.7, 1.5, 2.8, 4.0],
      [4.0, 3.4, 2.0, 1.2],
      [1.2, 2.4, 4.1, 5.6],
      [5.6, 4.7, 2.5, 0.9],
    ],
  })
  const wideRangeSnapshot = collectRoadCollisionDescriptors(wideRangeRoad)
  assert.ok(wideRangeSnapshot, 'wide range road should build collision data')
  assert.ok(
    wideRangeSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'static-mesh'),
    'wide range road should emit static-mesh collision in the aggressive range test',
  )

  const steepRoad = createRoadNode({
    id: 'road:steep',
    vertices: [
      [0, 0],
      [12, 0],
      [24, 0],
      [36, 0],
    ],
    segmentHeights: [
      [0, 5, 10, 15],
      [15, 20, 25, 30],
      [30, 30, 30, 30],
    ],
  })
  const steepSnapshot = collectRoadCollisionDescriptors(steepRoad)
  assert.ok(steepSnapshot, 'steep road should build collision data')
  assert.ok(
    steepSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'static-mesh'),
    'steep road should emit static-mesh collision for the steep spans',
  )

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
  assert.equal(
    crossingSnapshot.descriptors.some((entry) => entry.shapeDefinition.kind === 'heightfield'),
    false,
    'road collision descriptors must never emit heightfield shapes',
  )

  const bodyKinds = []
  const builtBodies = buildRoadCollisionBodies({
    ...complexRoad,
    roadObject: new THREE.Group(),
    createBody: (_node, _component, shapeDefinition) => {
      bodyKinds.push(shapeDefinition?.kind ?? null)
      return {
        body: { name: 'stub-body' },
        orientationAdjustment: null,
      }
    },
  })
  assert.ok(builtBodies, 'complex road should build rigidbody collision bodies')
  assert.ok(bodyKinds.includes('static-mesh'), 'complex road runtime bodies should use static-mesh shapes')

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

  const sampleManifest = {
    version: ROAD_COLLISION_COMPILED_MANIFEST_VERSION,
    sceneId: 'scene:road-binary',
    revision: 42,
    roads: [{
      nodeId: 'road:binary',
      path: buildRoadCollisionCompiledPackagePath('scene:road-binary', 'road:binary'),
      signature: 'sig:binary',
      bodyCount: 1,
      shapeCount: 2,
    }],
  }
  const samplePackage = {
    version: ROAD_COLLISION_COMPILED_PACKAGE_VERSION,
    sceneId: 'scene:road-binary',
    roadNodeId: 'road:binary',
    signature: 'sig:binary',
    asset: {
      format: 'harmony-physics',
      materials: [],
      shapes: [],
      bodies: [],
      vehicles: [],
    },
  }
  assert.equal(buildRoadCollisionCompiledManifestPath('scene:road-binary').endsWith('.bin'), true, 'road collision manifest path should use .bin')
  assert.equal(buildRoadCollisionCompiledPackagePath('scene:road-binary', 'road:binary').endsWith('.bin'), true, 'road collision package path should use .bin')
  const encodedManifest = serializeRoadCollisionCompiledManifest(sampleManifest)
  const decodedManifest = deserializeRoadCollisionCompiledManifest(encodedManifest)
  assert.deepEqual(decodedManifest, sampleManifest, 'road collision manifest should round-trip through binary encoding')
  const encodedPackage = serializeRoadCollisionCompiledPackage(samplePackage)
  const decodedPackage = deserializeRoadCollisionCompiledPackage(encodedPackage)
  assert.deepEqual(decodedPackage, samplePackage, 'road collision package should round-trip through binary encoding')

  console.log('road-collision-mixed-regression: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
