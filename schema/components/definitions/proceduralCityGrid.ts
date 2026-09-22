import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ProceduralCityComponentProps } from './proceduralCityComponent'

const GRID_ROAD_COLOR = 0x2b3035
const GRID_SIDEWALK_COLOR = 0xb8b5af
const GRID_MARKING_COLOR = 0xe5e1d8
const GRID_STREETLIGHT_COLOR = 0x4d535a
const GRID_TREE_CROWN_COLOR = 0x4f8050
const GRID_BUILDING_PALETTE = [
  '#d8c7c7',
  '#d8d2c4',
  '#c9d6cf',
  '#cbd2e0',
  '#d9cde2',
  '#e3d6c4',
  '#c9d8dd',
  '#d7d0c4',
  '#b9c6bf',
  '#c9bfad',
]
const GRID_CAR_COLORS = [
  0xf5c518,
  0x111216,
  0xe9e8e3,
  0xb2b5b8,
  0x3e4247,
  0x1c2a3f,
  0x571f1f,
]

type GridPlacement = {
  x: number
  z: number
  yaw: number
  scaleX: number
  scaleY: number
  scaleZ: number
}

function rotate2(point: THREE.Vector2, angle: number): THREE.Vector2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return new THREE.Vector2(point.x * cos - point.y * sin, point.x * sin + point.y * cos)
}

function resolveLongestEdgeAngle(points: THREE.Vector2[]): number {
  let bestAngle = 0
  let bestLengthSq = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    if (lengthSq > bestLengthSq) {
      bestLengthSq = lengthSq
      bestAngle = Math.atan2(dy, dx)
    }
  }
  return bestAngle
}

function isPointInsidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y) / (b.y - a.y)) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function signedPolygonArea(points: THREE.Vector2[]): number {
  let area = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!
    const b = points[i]!
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

function hashGrid(seed: number, x: number, y: number): number {
  let value = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) ^ (seed | 0)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function createGridColor(seed: number, index: number, palette: readonly string[] | number[]): THREE.Color {
  const value = palette[index % palette.length]!
  const color = typeof value === 'number'
    ? new THREE.Color(value)
    : new THREE.Color(value)
  const brightness = 0.92 + hashGrid(seed, index, 17) * 0.16
  color.multiplyScalar(brightness)
  return color
}

function makeGridInstancedMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: GridPlacement[],
  name: string,
  colors?: THREE.Color[],
): THREE.InstancedMesh | null {
  if (!placements.length) {
    return null
  }
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
  mesh.name = name
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = true
  mesh.matrixAutoUpdate = false
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  placements.forEach((placement, index) => {
    position.set(placement.x, 0, placement.z)
    quaternion.setFromAxisAngle(up, placement.yaw)
    scale.set(placement.scaleX, placement.scaleY, placement.scaleZ)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
    if (colors) {
      mesh.setColorAt(index, colors[index] ?? colors[0]!)
    }
  })
  mesh.count = placements.length
  mesh.computeBoundingSphere()
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true
  }
  return mesh
}

function createGridRoadShape(rotated: THREE.Vector2[], localCenterX: number, localCenterZ: number): THREE.BufferGeometry {
  // ShapeGeometry is authored in the XY plane and rotated onto XZ afterwards, which maps shape
  // +Y onto world -Z. Negating the local Z coordinate therefore keeps the base polygon in the
  // exact same local frame as the blocks created below, so it lines up with the host footprint.
  const shapePoints = rotated.map((point) => new THREE.Vector2(
    point.x - localCenterX,
    -(point.y - localCenterZ),
  ))
  if (signedPolygonArea(shapePoints) < 0) {
    shapePoints.reverse()
  }
  const shape = new THREE.Shape(shapePoints)
  const geometry = new THREE.ShapeGeometry(shape, 4)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

function createGridSidewalkGeometry(width: number, depth: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate(0, height * 0.5, 0)
  return geometry
}

function createGridBuildingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3))
  return geometry
}

function createGridCarGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1.75, 0.5, 4.1)
  body.translate(0, 0.45, 0)
  const cabin = new THREE.BoxGeometry(1.55, 0.48, 1.9)
  cabin.translate(0, 1.02, -0.15)
  const merged = mergeGeometries([body, cabin], false) ?? body
  body.dispose()
  cabin.dispose()
  const count = merged.getAttribute('position').count
  merged.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3))
  merged.computeVertexNormals()
  return merged
}

function createGridStreetlightGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.08, 0.12, 5.2, 6)
  pole.translate(0, 2.6, 0)
  const arm = new THREE.BoxGeometry(1.6, 0.08, 0.08)
  arm.translate(0.62, 5.05, 0)
  const head = new THREE.BoxGeometry(0.28, 0.18, 0.48)
  head.translate(1.32, 5.0, 0)
  const merged = mergeGeometries([pole, arm, head], false) ?? pole
  pole.dispose()
  arm.dispose()
  head.dispose()
  merged.computeVertexNormals()
  return merged
}

function createGridTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1.4, 6)
  trunk.translate(0, 0.7, 0)
  const crown = new THREE.SphereGeometry(0.95, 7, 5)
  crown.translate(0, 2.1, 0)
  const merged = mergeGeometries([trunk, crown], false) ?? trunk
  trunk.dispose()
  crown.dispose()
  merged.computeVertexNormals()
  return merged
}

function createGridMarkingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function createGridStreetLights(
  blocks: Array<{ x: number; z: number; w: number; d: number }>,
  polygon: THREE.Vector2[],
): GridPlacement[] {
  const placements: GridPlacement[] = []
  const spacing = 30
  blocks.forEach((block) => {
    const edges = [
      { x0: block.x, z0: block.z, dx: 1, dz: 0, length: block.w },
      { x0: block.x, z0: block.z + block.d, dx: 1, dz: 0, length: block.w },
      { x0: block.x, z0: block.z, dx: 0, dz: 1, length: block.d },
      { x0: block.x + block.w, z0: block.z, dx: 0, dz: 1, length: block.d },
    ]
    edges.forEach((edge) => {
      const count = Math.max(1, Math.round(edge.length / spacing))
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count
        const x = edge.x0 + edge.dx * edge.length * t
        const z = edge.z0 + edge.dz * edge.length * t
        if (isPointInsidePolygon(new THREE.Vector2(x, z), polygon)) {
          placements.push({ x, z, yaw: edge.dz === 0 ? 0 : Math.PI / 2, scaleX: 1, scaleY: 1, scaleZ: 1 })
        }
      }
    })
  })
  return placements
}

function createGridCars(
  props: ProceduralCityComponentProps,
  cityW: number,
  cityD: number,
  street: number,
  blockW: number,
  blockD: number,
  blocksX: number,
  blocksZ: number,
  localCenterX: number,
  localCenterZ: number,
  polygon: THREE.Vector2[],
): GridPlacement[] {
  const placements: GridPlacement[] = []
  const density = clamp01(props.gridFurnitureDensity)
  for (let bx = 0; bx < blocksX - 1; bx += 1) {
    const streetX = -cityW / 2 + (bx + 1) * blockW + bx * street + street * 0.5
    for (let t = 6; t < cityD - 6; t += 6.5) {
      if (hashGrid(Math.trunc(props.seed) ^ 0xaa11, bx * 101 + Math.floor(t), 3) < density * 0.7) {
        const x = streetX + 1.6
        const z = -cityD / 2 + t
        const local = new THREE.Vector2(x - localCenterX, z - localCenterZ)
        if (isPointInsidePolygon(local, polygon)) {
          placements.push({ x: local.x, z: local.y, yaw: Math.PI / 2, scaleX: 1, scaleY: 1, scaleZ: 1 })
        }
      }
    }
  }
  for (let bz = 0; bz < blocksZ - 1; bz += 1) {
    const streetZ = -cityD / 2 + (bz + 1) * blockD + bz * street + street * 0.5
    for (let t = 6; t < cityW - 6; t += 6.5) {
      if (hashGrid(Math.trunc(props.seed) ^ 0xbb22, bz * 173 + Math.floor(t), 5) < density * 0.7) {
        const x = -cityW / 2 + t
        const z = streetZ - 1.6
        const local = new THREE.Vector2(x - localCenterX, z - localCenterZ)
        if (isPointInsidePolygon(local, polygon)) {
          placements.push({ x: local.x, z: local.y, yaw: 0, scaleX: 1, scaleY: 1, scaleZ: 1 })
        }
      }
    }
  }
  return placements
}

function createGridTrees(
  blocks: Array<{ x: number; z: number; w: number; d: number }>,
  props: ProceduralCityComponentProps,
  polygon: THREE.Vector2[],
): GridPlacement[] {
  const placements: GridPlacement[] = []
  const density = clamp01(props.gridFurnitureDensity)
  blocks.forEach((block) => {
    const corners: Array<[number, number]> = [
      [block.x - 1.8, block.z - 1.8],
      [block.x + block.w + 1.8, block.z - 1.8],
      [block.x - 1.8, block.z + block.d + 1.8],
      [block.x + block.w + 1.8, block.z + block.d + 1.8],
    ]
    corners.forEach(([x, z], index) => {
      if (hashGrid(Math.trunc(props.seed) ^ 0x33cc, Math.round(block.x), Math.round(block.z) + index) < density * 0.7) {
        if (isPointInsidePolygon(new THREE.Vector2(x, z), polygon)) {
          const scale = 0.8 + hashGrid(Math.trunc(props.seed) ^ 0x44dd, index, Math.round(block.x)) * 0.5
          placements.push({ x, z, yaw: hashGrid(Math.trunc(props.seed), index, 7) * Math.PI * 2, scaleX: scale, scaleY: scale, scaleZ: scale })
        }
      }
    })
  })
  return placements
}

export function buildProceduralCityGridGroup(
  points: THREE.Vector2[],
  props: ProceduralCityComponentProps,
  surfaceY: number,
): THREE.Group {
  if (points.length < 3) {
    return new THREE.Group()
  }

  const angle = resolveLongestEdgeAngle(points)
  const rotated = points.map((point) => rotate2(point, -angle))
  const min = new THREE.Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector2(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  rotated.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.y = Math.min(min.y, point.y)
    max.x = Math.max(max.x, point.x)
    max.y = Math.max(max.y, point.y)
  })
  const width = Math.max(1, max.x - min.x)
  const depth = Math.max(1, max.y - min.y)
  const street = Math.max(4, props.gridStreetWidth)
  const blockW = Math.max(20, props.gridBlockWidth)
  const blockD = Math.max(20, props.gridBlockDepth)
  const sidewalk = Math.max(1, Math.min(props.gridSidewalkWidth, Math.min(blockW, blockD) * 0.4))
  const curb = Math.max(0, props.gridCurbHeight)
  const blocksX = Math.max(1, Math.ceil((width + street) / (blockW + street)))
  const blocksZ = Math.max(1, Math.ceil((depth + street) / (blockD + street)))
  const cityW = blocksX * blockW + (blocksX - 1) * street
  const cityD = blocksZ * blockD + (blocksZ - 1) * street
  const localCenterX = (min.x + max.x) * 0.5
  const localCenterZ = (min.y + max.y) * 0.5
  const worldCenter = rotate2(new THREE.Vector2(localCenterX, localCenterZ), angle)
  const group = new THREE.Group()
  group.name = 'ProceduralCityGrid'
  group.rotation.y = -angle
  // Floors extrude downwards from their top face, so the grid must start at the resolved
  // surface height to stay flush with the footprint it is mounted on.
  group.position.set(worldCenter.x, surfaceY, worldCenter.y)

  const localPolygon = rotated.map((point) => new THREE.Vector2(point.x - localCenterX, point.y - localCenterZ))

  const roadGeometry = createGridRoadShape(rotated, localCenterX, localCenterZ)
  const roadMaterial = new THREE.MeshStandardMaterial({ color: GRID_ROAD_COLOR, roughness: 0.94, metalness: 0 })
  const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial)
  roadMesh.name = 'GridRoad'
  group.add(roadMesh)

  const blocks: Array<{ x: number; z: number; w: number; d: number }> = []
  for (let bz = 0; bz < blocksZ; bz += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const blockX = -cityW / 2 + bx * (blockW + street)
      const blockZ = -cityD / 2 + bz * (blockD + street)
      const center = new THREE.Vector2(blockX + blockW / 2 - localCenterX, blockZ + blockD / 2 - localCenterZ)
      if (!isPointInsidePolygon(center, localPolygon)) {
        continue
      }
      blocks.push({ x: blockX - localCenterX, z: blockZ - localCenterZ, w: blockW, d: blockD })
    }
  }

  if (blocks.length) {
    const sidewalkGeometry = createGridSidewalkGeometry(blockW, blockD, curb)
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: GRID_SIDEWALK_COLOR, roughness: 0.9, metalness: 0 })
    const sidewalkMesh = makeGridInstancedMesh(
      sidewalkGeometry,
      sidewalkMaterial,
      blocks.map((block) => ({ x: block.x + block.w / 2, z: block.z + block.d / 2, yaw: 0, scaleX: 1, scaleY: 1, scaleZ: 1 })),
      'GridSidewalks',
    )
    if (sidewalkMesh) {
      group.add(sidewalkMesh)
    }
  }

  const innerLotX = Math.max(2, (blockW - sidewalk * 2) / Math.max(1, props.gridLotsX))
  const innerLotZ = Math.max(2, (blockD - sidewalk * 2) / Math.max(1, props.gridLotsZ))
  const buildingPlacements: GridPlacement[] = []
  const buildingColors: THREE.Color[] = []
  blocks.forEach((block) => {
    for (let lz = 0; lz < props.gridLotsZ; lz += 1) {
      for (let lx = 0; lx < props.gridLotsX; lx += 1) {
        const lotCenterX = block.x + sidewalk + (lx + 0.5) * innerLotX
        const lotCenterZ = block.z + sidewalk + (lz + 0.5) * innerLotZ
        const local = new THREE.Vector2(lotCenterX, lotCenterZ)
        if (!isPointInsidePolygon(local, localPolygon)) {
          continue
        }
        const index = buildingPlacements.length
        const heightHash = hashGrid(Math.trunc(props.seed) ^ 0x2c4a, Math.round(lotCenterX * 10), Math.round(lotCenterZ * 10))
        const heightT = Math.pow(heightHash, 1.7)
        const height = props.minHeight + (props.maxHeight - props.minHeight) * heightT
        const widthScale = innerLotX * lerpNumber(0.68, 0.88, hashGrid(Math.trunc(props.seed), index, 11))
        const depthScale = innerLotZ * lerpNumber(0.68, 0.88, hashGrid(Math.trunc(props.seed), index, 23))
        buildingPlacements.push({
          x: lotCenterX,
          z: lotCenterZ,
          yaw: 0,
          scaleX: widthScale,
          scaleY: height,
          scaleZ: depthScale,
        })
        buildingColors.push(createGridColor(Math.trunc(props.seed), index, GRID_BUILDING_PALETTE))
      }
    }
  })
  if (buildingPlacements.length) {
    const buildingGeometry = createGridBuildingGeometry()
    const buildingMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })
    const buildingMesh = makeGridInstancedMesh(
      buildingGeometry,
      buildingMaterial,
      buildingPlacements,
      'GridBuildings',
      buildingColors,
    )
    if (buildingMesh) {
      group.add(buildingMesh)
    }
  }

  const markingGeometry = createGridMarkingGeometry()
  const markingMaterial = new THREE.MeshBasicMaterial({ color: GRID_MARKING_COLOR, side: THREE.DoubleSide })
  const markingPlacements: GridPlacement[] = []
  for (let bx = 0; bx < blocksX - 1; bx += 1) {
    const x = -cityW / 2 + (bx + 1) * blockW + bx * street + street * 0.5
    const local = new THREE.Vector2(x - localCenterX, 0)
    if (isPointInsidePolygon(local, localPolygon)) {
      markingPlacements.push({ x: local.x, z: local.y, yaw: 0, scaleX: 0.22, scaleY: 1, scaleZ: cityD })
    }
  }
  for (let bz = 0; bz < blocksZ - 1; bz += 1) {
    const z = -cityD / 2 + (bz + 1) * blockD + bz * street + street * 0.5
    const local = new THREE.Vector2(0, z - localCenterZ)
    if (isPointInsidePolygon(local, localPolygon)) {
      markingPlacements.push({ x: local.x, z: local.y, yaw: Math.PI / 2, scaleX: 0.22, scaleY: 1, scaleZ: cityW })
    }
  }
  for (let iz = 0; iz < blocksZ - 1; iz += 1) {
    for (let ix = 0; ix < blocksX - 1; ix += 1) {
      const sx = -cityW / 2 + (ix + 1) * blockW + ix * street + street * 0.5
      const sz = -cityD / 2 + (iz + 1) * blockD + iz * street + street * 0.5
      const crosswalkWidth = street * 0.82
      const crosswalkDepth = 0.7
      const offsets = [-street * 0.18, street * 0.18]
      offsets.forEach((offset) => {
        const vertical = new THREE.Vector2(sx - localCenterX, sz + offset - localCenterZ)
        if (isPointInsidePolygon(vertical, localPolygon)) {
          markingPlacements.push({ x: vertical.x, z: vertical.y, yaw: 0, scaleX: crosswalkWidth, scaleY: 1, scaleZ: crosswalkDepth })
        }
        const horizontal = new THREE.Vector2(sx + offset - localCenterX, sz - localCenterZ)
        if (isPointInsidePolygon(horizontal, localPolygon)) {
          markingPlacements.push({ x: horizontal.x, z: horizontal.y, yaw: Math.PI / 2, scaleX: crosswalkWidth, scaleY: 1, scaleZ: crosswalkDepth })
        }
      })
    }
  }
  if (markingPlacements.length) {
    const markingMesh = makeGridInstancedMesh(markingGeometry, markingMaterial, markingPlacements, 'GridMarkings')
    if (markingMesh) {
      group.add(markingMesh)
    }
  }

  const streetlightGeometry = createGridStreetlightGeometry()
  const streetlightMaterial = new THREE.MeshStandardMaterial({ color: GRID_STREETLIGHT_COLOR, roughness: 0.85, metalness: 0.1 })
  const streetlightPlacements = createGridStreetLights(blocks, localPolygon)
  const streetlightMesh = makeGridInstancedMesh(streetlightGeometry, streetlightMaterial, streetlightPlacements, 'GridStreetlights')
  if (streetlightMesh) {
    group.add(streetlightMesh)
  }

  const carGeometry = createGridCarGeometry()
  const carMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.2 })
  const carPlacements = createGridCars(
    props,
    cityW,
    cityD,
    street,
    blockW,
    blockD,
    blocksX,
    blocksZ,
    localCenterX,
    localCenterZ,
    localPolygon,
  )
  const carColors = carPlacements.map((_, index) => createGridColor(Math.trunc(props.seed), index, GRID_CAR_COLORS))
  const carMesh = makeGridInstancedMesh(carGeometry, carMaterial, carPlacements, 'GridCars', carColors)
  if (carMesh) {
    group.add(carMesh)
  }

  const treeGeometry = createGridTreeGeometry()
  const treeMaterial = new THREE.MeshStandardMaterial({ color: GRID_TREE_CROWN_COLOR, roughness: 0.9 })
  const treePlacements = createGridTrees(blocks, props, localPolygon)
  if (treePlacements.length) {
    const treeMesh = makeGridInstancedMesh(treeGeometry, treeMaterial, treePlacements, 'GridTrees')
    if (treeMesh) {
      group.add(treeMesh)
    }
  }

  return group
}
