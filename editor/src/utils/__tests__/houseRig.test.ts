import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  componentManager,
  subscribeHouseRigRuntime,
} from '@schema/components'
import {
  applyHouseRigDeformPlan,
  buildHouseRigRestSnapshot,
  clampHouseRigDimensions,
  createHouseRigDimensionLimits,
  getHouseRigScript,
  listHouseRigScripts,
  parseHouseRigPartName,
  validateHouseRigDeformPlan,
  type HouseRigComponentProps,
  type HouseRigDimensions,
  type HouseRigRestSnapshot,
} from '@schema/houseRig'
import type { SceneNode } from '@schema/core'

function makeMesh(
  name: string,
  points: Array<[number, number, number]>,
  indices: number[],
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      Array.from({ length: points.length * 2 }, (_, index) => index % 2),
      2,
    ),
  )
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  return mesh
}

function makeQuad(
  name: string,
  points: Array<[number, number, number]>,
): THREE.Mesh {
  return makeMesh(name, points, [0, 1, 2, 0, 2, 3])
}

function createTenPartHouse(): {
  root: THREE.Group
  meshes: Map<string, THREE.Mesh>
} {
  const root = new THREE.Group()
  root.name = 'Ten Part House'
  const meshes = new Map<string, THREE.Mesh>()
  const add = (name: string, points: Array<[number, number, number]>) => {
    const mesh = makeQuad(name, points)
    meshes.set(name, mesh)
    root.add(mesh)
  }
  const addMesh = (
    name: string,
    points: Array<[number, number, number]>,
    indices: number[],
  ) => {
    const mesh = makeMesh(name, points, indices)
    meshes.set(name, mesh)
    root.add(mesh)
  }

  add('墙-前-内', [
    [-1.06, 0, -1.4],
    [-1.06, 2.1, -1.4],
    [-1.06, 2.1, 1.4],
    [-1.06, 0, 1.4],
  ])
  add('墙-前-外', [
    [-1.07, 0, -1.4],
    [-1.07, 2.1, -1.4],
    [-1.07, 2.1, 1.4],
    [-1.07, 0, 1.4],
  ])
  add('墙-后-内', [
    [1.06, 0, -1.4],
    [1.06, 2.1, -1.4],
    [1.06, 2.1, 1.4],
    [1.06, 0, 1.4],
  ])
  add('墙-后-外', [
    [1.07, 0, -1.4],
    [1.07, 2.1, -1.4],
    [1.07, 2.1, 1.4],
    [1.07, 0, 1.4],
  ])
  const gableIndices = [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]
  addMesh('墙-左-内', [
    [-1.074726, 0.00018, 1.39],
    [0, 0.00018, 1.39],
    [1.074726, 0.00018, 1.39],
    [-1.074726, 2.081277, 1.39],
    [0, 2.95, 1.39],
    [1.074726, 2.081277, 1.39],
  ], gableIndices)
  addMesh('墙-左-外', [
    [1.074726, 0.00018, 1.4],
    [0, 0.00018, 1.4],
    [-1.074726, 0.00018, 1.4],
    [1.074726, 2.081458, 1.4],
    [0, 2.95018, 1.4],
    [-1.074726, 2.081458, 1.4],
  ], gableIndices)
  addMesh('墙-右-内', [
    [-1.074726, 0.00018, -1.4],
    [0, 0.00018, -1.4],
    [1.074726, 0.00018, -1.4],
    [-1.074726, 2.081458, -1.4],
    [0, 2.95018, -1.4],
    [1.074726, 2.081458, -1.4],
  ], gableIndices)
  addMesh('墙-右-外', [
    [1.074726, 0, -1.39],
    [0, 0, -1.39],
    [-1.074726, 0, -1.39],
    [1.074726, 2.081277, -1.39],
    [0, 2.95, -1.39],
    [-1.074726, 2.081277, -1.39],
  ], gableIndices)
  addMesh('墙-上-内', [
    [1.5, 1.768595, -1.5],
    [-1.5, 1.768594, -1.5],
    [1.5, 1.768595, 1.5],
    [-1.5, 1.768594, 1.5],
    [0, 2.965696, 1.5],
    [0, 2.965696, -1.5],
  ], [0, 1, 4, 0, 4, 5, 1, 3, 4, 3, 2, 4, 2, 0, 5, 2, 5, 4])
  addMesh('墙-上-外', [
    [-1.5, 1.8, -1.5],
    [1.5, 1.8, -1.5],
    [-1.5, 1.8, 1.5],
    [1.5, 1.8, 1.5],
    [0, 3, 1.500368],
    [0, 3, -1.499632],
  ], [0, 1, 4, 0, 4, 5, 1, 3, 4, 3, 2, 4, 2, 0, 5, 2, 5, 4])
  return { root, meshes }
}

function createRest(root: THREE.Group): HouseRigRestSnapshot {
  return buildHouseRigRestSnapshot({
    root,
    assetId: 'sha256-house-fixture',
  })
}

function dimensions(
  rest: HouseRigRestSnapshot,
  overrides: Partial<HouseRigDimensions>,
): HouseRigDimensions {
  return { ...rest.dimensions, ...overrides }
}

function planPart(snapshot: HouseRigRestSnapshot, plan: ReturnType<NonNullable<ReturnType<typeof getHouseRigScript>>['buildPlan']>, name: string) {
  const restPart = snapshot.parts.find((part) => part.meshName === name)
  expect(restPart).toBeTruthy()
  return plan.parts.find((part) => part.key === restPart!.key)!
}

function positionsOf(part: { positionsRoot: ArrayLike<number> }): number[] {
  return Array.from(part.positionsRoot)
}

function roofSurfaceYAtX(
  part: { positionsRoot: ArrayLike<number> },
  x: number,
): number {
  const points = Array.from({ length: part.positionsRoot.length / 3 }, (_, index) => ({
    x: part.positionsRoot[index * 3] ?? 0,
    y: part.positionsRoot[index * 3 + 1] ?? 0,
  }))
  const ridgeY = Math.max(...points.map((point) => point.y))
  const eaveY = Math.min(...points.map((point) => point.y))
  const ridgeX = points.find((point) => point.y === ridgeY)?.x ?? 0
  const eaveXs = points.filter((point) => point.y === eaveY).map((point) => point.x)
  const eaveRadius = Math.max(...eaveXs.map((value) => Math.abs(value - ridgeX)))
  return ridgeY - (Math.abs(x - ridgeX) / Math.max(1e-6, eaveRadius)) * (ridgeY - eaveY)
}

describe('House Rig naming and scripts', () => {
  it('maps the current Chinese names and canonical English aliases', () => {
    expect(parseHouseRigPartName('墙-上-内')).toEqual({
      role: 'roof',
      side: 'top',
      layer: 'inner',
    })
    expect(parseHouseRigPartName('wall-front-outer')).toEqual({
      role: 'wall',
      side: 'front',
      layer: 'outer',
    })
    expect(parseHouseRigPartName('window-left-inner')).toEqual({
      role: 'window',
      side: 'left',
      layer: 'inner',
    })
  })

  it('registers versioned scripts and identifies the ten-part fixture', () => {
    expect(listHouseRigScripts().map((script) => `${script.id}@${script.version}`))
      .toEqual(expect.arrayContaining([
        'basic-naming@1.0.0',
        'current-ten-part-house@1.0.0',
      ]))
    const root = createTenPartHouse().root
    const rest = createRest(root)
    const script = getHouseRigScript('current-ten-part-house', '1.0.0')!
    expect(script.getCompatibility({
      assetId: rest.assetId,
      topologyHash: rest.topologyHash,
      dimensions: rest.dimensions,
      parts: rest.parts,
    })).toMatchObject({ compatible: true })
  })

  it('accepts a second synthetic white model through the same naming contract', () => {
    const root = new THREE.Group()
    const add = (name: string, y: number, z: number) => {
      const mesh = makeQuad(name, [
        [-2, y, z],
        [2, y, z],
        [2, y + 1, z],
        [-2, y + 1, z],
      ])
      root.add(mesh)
    }
    add('wall-front-inner', 0, 1)
    add('wall-left-outer', 0, 2)
    add('roof-front-inner', 1.5, 0)
    add('roof-front-outer', 1.6, -0.5)
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    expect(script.getCompatibility({
      assetId: rest.assetId,
      topologyHash: rest.topologyHash,
      dimensions: rest.dimensions,
      parts: rest.parts,
    })).toMatchObject({ compatible: true })
  })
})

describe('House Rig deployment plans', () => {
  it('allows every axis to grow without an upper limit', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const limits = createHouseRigDimensionLimits(rest.dimensions)
    expect(limits.width.max).toBeNull()
    expect(limits.depth.max).toBeNull()
    expect(limits.wallHeight.max).toBeNull()

    const expanded = {
      width: rest.dimensions.width * 100,
      depth: rest.dimensions.depth * 100,
      wallHeight: rest.dimensions.wallHeight * 100,
    }
    expect(clampHouseRigDimensions(expanded, limits, rest.dimensions)).toEqual(expanded)
  })

  it('keeps roof shape rigid while translating it with wall height', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    const deltaHeight = 1.25
    const nextDimensions = dimensions(rest, {
      wallHeight: rest.dimensions.wallHeight + deltaHeight,
    })
    const plan = script.buildPlan(rest, nextDimensions)
    expect(validateHouseRigDeformPlan(rest, plan)).toEqual([])

    for (const roofName of ['墙-上-内', '墙-上-外']) {
      const restPart = rest.parts.find((part) => part.meshName === roofName)!
      const planned = planPart(rest, plan, roofName)
      for (let index = 0; index < restPart.positionsRoot.length; index += 3) {
        expect(planned.positionsRoot[index]).toBeCloseTo(restPart.positionsRoot[index]!, 6)
        expect(planned.positionsRoot[index + 1]).toBeCloseTo(
          restPart.positionsRoot[index + 1]! + deltaHeight,
          6,
        )
        expect(planned.positionsRoot[index + 2]).toBeCloseTo(restPart.positionsRoot[index + 2]!, 6)
      }
    }
  })

  it('keeps every wall-to-roof contact gap stable while changing all three dimensions', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    const nextDimensions = dimensions(rest, {
      width: rest.dimensions.width * 1.8,
      depth: rest.dimensions.depth * 1.2,
      wallHeight: rest.dimensions.wallHeight + 1.3,
    })
    const plan = script.buildPlan(rest, nextDimensions)

    for (const wall of rest.parts.filter((part) => part.role === 'wall')) {
      const roofName = wall.layer === 'inner' ? '墙-上-内' : '墙-上-外'
      const restRoof = rest.parts.find((part) => part.meshName === roofName)!
      const plannedWall = planPart(rest, plan, wall.meshName)
      const plannedRoof = planPart(rest, plan, roofName)
      const wallHeight = wall.bounds.max.y - wall.bounds.min.y
      const bottomTolerance = Math.max(1e-4, wallHeight * 1e-3)
      for (let index = 0; index < wall.positionsRoot.length; index += 3) {
        const restY = wall.positionsRoot[index + 1]!
        if (restY <= wall.bounds.min.y + bottomTolerance) {
          continue
        }
        const restX = wall.positionsRoot[index]!
        const plannedX = plannedWall.positionsRoot[index]!
        const restGap = roofSurfaceYAtX(restRoof, restX) - restY
        const plannedGap = roofSurfaceYAtX(plannedRoof, plannedX)
          - plannedWall.positionsRoot[index + 1]!
        expect(plannedGap).toBeCloseTo(restGap, 6)
      }
    }
  })

  it('keeps wall corner seams together during width expansion', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    const plan = script.buildPlan(rest, dimensions(rest, {
      width: rest.dimensions.width + 2,
    }))
    const endWall = planPart(rest, plan, '墙-前-外')
    const sideWall = planPart(rest, plan, '墙-左-外')
    const endWallX = endWall.positionsRoot[0]!
    const sideWallMinX = Math.min(
      ...[0, 1, 2, 3].map((index) => sideWall.positionsRoot[index * 3]!),
    )
    expect(Math.abs(endWallX - sideWallMinX)).toBeLessThanOrEqual(0.02)
  })

  it('keeps wall corner seams together during depth expansion', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    const plan = script.buildPlan(rest, dimensions(rest, {
      depth: rest.dimensions.depth + 2,
    }))
    const sideWall = planPart(rest, plan, '墙-左-外')
    const endWall = planPart(rest, plan, '墙-前-外')
    const sideWallZ = sideWall.positionsRoot[2]!
    const endWallMaxZ = Math.max(
      ...[0, 1, 2, 3].map((index) => endWall.positionsRoot[index * 3 + 2]!),
    )
    expect(Math.abs(sideWallZ - endWallMaxZ)).toBeLessThanOrEqual(1e-5)
  })

  it('is deterministic and applies the same plan from the immutable rest snapshot', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const script = getHouseRigScript('basic-naming', '1.0.0')!
    const target = dimensions(rest, {
      width: rest.dimensions.width * 1.4,
      depth: rest.dimensions.depth * 0.8,
      wallHeight: rest.dimensions.wallHeight * 1.2,
    })
    const first = script.buildPlan(rest, target)
    const second = script.buildPlan(rest, target)
    expect(first.parts.map((part) => positionsOf(part)))
      .toEqual(second.parts.map((part) => positionsOf(part)))
    applyHouseRigDeformPlan(root, rest, first)
    applyHouseRigDeformPlan(root, rest, second)
    expect(validateHouseRigDeformPlan(rest, second)).toEqual([])
  })

  it('rejects non-finite deformation output', () => {
    const { root } = createTenPartHouse()
    const rest = createRest(root)
    const plan = {
      parts: rest.parts.map((part) => ({
        key: part.key,
        positionsRoot: new Float32Array(part.positionsRoot),
        uvs: part.uvs,
      })),
      handles: {
        width: { x: 0, y: 0, z: 0 },
        depth: { x: 0, y: 0, z: 0 },
        wallHeight: { x: 0, y: 0, z: 0 },
      },
      bounds: rest.bounds,
      warnings: [],
    }
    plan.parts[0]!.positionsRoot[0] = Number.NaN
    expect(validateHouseRigDeformPlan(rest, plan).join('\n')).toContain('non-finite')
  })
})

describe('House Rig runtime isolation', () => {
  it('clones shared geometry per component instance and updates only the edited node', () => {
    const fixtureA = createTenPartHouse()
    const fixtureB = createTenPartHouse()
    const rest = createRest(fixtureA.root)
    const sharedGeometry = fixtureA.meshes.get('墙-前-内')!.geometry
    const secondMesh = fixtureB.meshes.get('墙-前-内')!
    secondMesh.geometry.dispose()
    secondMesh.geometry = sharedGeometry
    const props: HouseRigComponentProps = {
      schemaVersion: 1,
      scriptId: 'basic-naming',
      scriptVersion: '1.0.0',
      assetId: rest.assetId,
      topologyHash: rest.topologyHash,
      restDimensions: rest.dimensions,
      dimensions: { ...rest.dimensions },
      parts: [],
    }
    const nodeA: SceneNode = {
      id: 'house-rig-a',
      name: 'House A',
      nodeType: 'Group',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      sourceAssetId: rest.assetId ?? undefined,
      components: {
        houseRig: {
          id: 'component-a',
          type: 'houseRig',
          enabled: true,
          props: JSON.parse(JSON.stringify(props)) as HouseRigComponentProps,
        },
      },
    }
    const nodeB: SceneNode = {
      ...nodeA,
      id: 'house-rig-b',
      name: 'House B',
      components: {
        houseRig: {
          id: 'component-b',
          type: 'houseRig',
          enabled: true,
          props: JSON.parse(JSON.stringify({
            ...props,
            dimensions: { ...rest.dimensions, width: rest.dimensions.width + 2 },
          })) as HouseRigComponentProps,
        },
      },
    }
    componentManager.attachRuntime(nodeA, fixtureA.root)
    componentManager.attachRuntime(nodeB, fixtureB.root)
    const geometryA = fixtureA.meshes.get('墙-前-内')!.geometry
    const geometryB = fixtureB.meshes.get('墙-前-内')!.geometry
    expect(geometryA).not.toBe(geometryB)
    expect(geometryA).not.toBe(sharedGeometry)
    expect(geometryB).not.toBe(sharedGeometry)
    expect(geometryA.getAttribute('position').getX(0))
      .not.toBeCloseTo(geometryB.getAttribute('position').getX(0), 4)
    componentManager.removeNode(nodeA.id)
    componentManager.removeNode(nodeB.id)
  })

  it('notifies subscribers when the runtime snapshot is attached and detached', () => {
    const fixture = createTenPartHouse()
    const rest = createRest(fixture.root)
    const node: SceneNode = {
      id: 'house-rig-runtime-subscription',
      name: 'House Runtime Subscription',
      nodeType: 'Group',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      sourceAssetId: rest.assetId ?? undefined,
      components: {
        houseRig: {
          id: 'component-runtime-subscription',
          type: 'houseRig',
          enabled: true,
          props: {
            schemaVersion: 1,
            scriptId: 'basic-naming',
            scriptVersion: '1.0.0',
            assetId: rest.assetId,
            topologyHash: rest.topologyHash,
            restDimensions: rest.dimensions,
            dimensions: { ...rest.dimensions },
            parts: [],
          },
        },
      },
    }
    const notifications: Array<{ parts: number } | null> = []
    const unsubscribe = subscribeHouseRigRuntime(node.id, (snapshot) => {
      notifications.push(snapshot ? { parts: snapshot.rest.parts.length } : null)
    })

    componentManager.attachRuntime(node, fixture.root)
    expect(notifications[notifications.length - 1]?.parts).toBe(10)

    componentManager.detachRuntime(node.id)
    expect(notifications[notifications.length - 1]).toBeNull()

    const notificationCount = notifications.length
    unsubscribe()
    componentManager.detachRuntime(node.id)
    expect(notifications).toHaveLength(notificationCount)
    componentManager.removeNode(node.id)
  })
})
