import * as THREE from 'three'
import { type GroundDynamicMesh, type GroundGenerationSettings, type GroundHeightMap } from '@harmony/schema'

const textureLoader = new THREE.TextureLoader()
let cachedMesh: THREE.Mesh | null = null

function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647
  if (value <= 0) {
    value += 2147483646
  }
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function buildPermutationTable(random: () => number): number[] {
  const permutation = new Array(256).fill(0).map((_, index) => index)
  for (let i = permutation.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(random() * (i + 1))
    const temp = permutation[i]
    permutation[i] = permutation[swapIndex]
    permutation[swapIndex] = temp
  }
  const table = new Array(512)
  for (let i = 0; i < 512; i += 1) {
    table[i] = permutation[i & 255]!
  }
  return table
}

function createPerlinNoise(seed?: number) {
  const random = seed === undefined ? Math.random : createSeededRandom(Math.floor(seed))
  const P = buildPermutationTable(random)

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (t: number, a: number, b: number) => a + t * (b - a)
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    const first = (h & 1) === 0 ? u : -u
    const second = (h & 2) === 0 ? v : -v
    return first + second
  }

  return (x: number, y: number, z: number) => {
    let X = Math.floor(x) & 255
    let Y = Math.floor(y) & 255
    let Z = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const A = P[X] + Y
    const AA = P[A] + Z
    const AB = P[A + 1] + Z
    const B = P[X + 1] + Y
    const BA = P[B] + Z
    const BB = P[B + 1] + Z

    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(P[AA], xf, yf, zf), grad(P[BA], xf - 1, yf, zf)),
        lerp(u, grad(P[AB], xf, yf - 1, zf), grad(P[BB], xf - 1, yf - 1, zf)),
      ),
      lerp(
        v,
        lerp(u, grad(P[AA + 1], xf, yf, zf - 1), grad(P[BA + 1], xf - 1, yf, zf - 1)),
        lerp(u, grad(P[AB + 1], xf, yf - 1, zf - 1), grad(P[BB + 1], xf - 1, yf - 1, zf - 1)),
      ),
    )
  }
}

function groundVertexKey(row: number, column: number): string {
  return `${row}:${column}`
}

function buildGroundGeometry(definition: GroundDynamicMesh): THREE.BufferGeometry {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const vertexCount = vertexColumns * vertexRows
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(columns * rows * 6)

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0

      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      uvs[vertexIndex * 2 + 0] = columns === 0 ? 0 : column / columns
      uvs[vertexIndex * 2 + 1] = rows === 0 ? 0 : 1 - row / rows

      vertexIndex += 1
    }
  }

  let indexPointer = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1

      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

const sculptNoise = createPerlinNoise(911)

function normalizeGroundGenerationSettings(settings: GroundGenerationSettings): GroundGenerationSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const normalizedScale = clamp(Math.abs(settings.noiseScale ?? 40), 1, 10000)
  const normalizedAmplitude = clamp(Math.abs(settings.noiseAmplitude ?? 0), 0, 500)
  const detailScale = settings.detailScale && settings.detailScale > 0 ? settings.detailScale : undefined
  const detailAmplitude = settings.detailAmplitude && settings.detailAmplitude > 0 ? settings.detailAmplitude : undefined
  const edgeFalloff = typeof settings.edgeFalloff === 'number' && Number.isFinite(settings.edgeFalloff)
    ? Math.max(0, settings.edgeFalloff)
    : undefined
  const normalized: GroundGenerationSettings = {
    seed: typeof settings.seed === 'number' && Number.isFinite(settings.seed)
      ? Math.floor(settings.seed)
      : undefined,
    noiseScale: normalizedScale,
    noiseAmplitude: normalizedAmplitude,
    detailScale,
    detailAmplitude,
    chunkSize: settings.chunkSize,
    chunkResolution: settings.chunkResolution,
    worldWidth: settings.worldWidth,
    worldDepth: settings.worldDepth,
    edgeFalloff,
    mode: settings.mode ?? 'perlin',
  }
  return normalized
}

export function applyGroundGeneration(
  definition: GroundDynamicMesh,
  settings: GroundGenerationSettings,
): GroundGenerationSettings {
  const normalized = normalizeGroundGenerationSettings(settings)
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const cellSize = definition.cellSize
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const heightMap: GroundHeightMap = {}

  if (normalized.mode === 'flat' || normalized.noiseAmplitude === 0) {
    for (let row = 0; row <= rows; row += 1) {
      for (let column = 0; column <= columns; column += 1) {
        heightMap[groundVertexKey(row, column)] = 0
      }
    }
    definition.heightMap = heightMap
    definition.generation = normalized
    return normalized
  }

  const baseNoise = createPerlinNoise(normalized.seed ?? 1337)
  const useDetail = Boolean(normalized.detailAmplitude && normalized.detailScale)
  const detailNoise = useDetail ? createPerlinNoise((normalized.seed ?? 1337) + 97) : null
  const mainScale = Math.max(0.001, normalized.noiseScale)
  const detailScale = Math.max(0.001, normalized.detailScale ?? normalized.noiseScale * 0.5)
  const detailAmplitude = normalized.detailAmplitude ?? 0

  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      let height = baseNoise(x / mainScale, z / mainScale, 0.5) * normalized.noiseAmplitude
      if (useDetail && detailNoise) {
        height += detailNoise(x / detailScale, z / detailScale, 0.5) * detailAmplitude
      }
      if (normalized.edgeFalloff && normalized.edgeFalloff > 0) {
        const nx = (column / columns) * 2 - 1
        const nz = (row / rows) * 2 - 1
        const edge = Math.max(Math.abs(nx), Math.abs(nz))
        const falloff = Math.pow(1 - Math.min(1, edge), normalized.edgeFalloff)
        height *= falloff
      }
      heightMap[groundVertexKey(row, column)] = height
    }
  }

  definition.heightMap = heightMap
  definition.generation = normalized
  return normalized
}

export interface SculptParams {
  point: THREE.Vector3
  radius: number
  strength: number
  shape: 'circle' | 'square' | 'star'
  isDigging: boolean
}

export function sculptGround(definition: GroundDynamicMesh, params: SculptParams): boolean {
  const { point, radius, strength, shape, isDigging } = params
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize
  const columns = definition.columns
  const rows = definition.rows

  // Point is in local coordinates
  const localX = point.x
  const localZ = point.z

  const minCol = Math.floor((localX - radius + halfWidth) / cellSize)
  const maxCol = Math.ceil((localX + radius + halfWidth) / cellSize)
  const minRow = Math.floor((localZ - radius + halfDepth) / cellSize)
  const maxRow = Math.ceil((localZ + radius + halfDepth) / cellSize)

  let modified = false

  for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
      for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
          const x = -halfWidth + col * cellSize
          const z = -halfDepth + row * cellSize
          
          const dx = x - localX
          const dz = z - localZ
          
          let dist = 0
          let isInside = false

          if (shape === 'square') {
              const maxDist = Math.max(Math.abs(dx), Math.abs(dz))
              if (maxDist <= radius) {
                  dist = maxDist
                  isInside = true
              }
          } else if (shape === 'star') {
               const r = Math.sqrt(dx * dx + dz * dz);
               const angle = Math.atan2(dz, dx);
               const n = 5;
               const step = Math.PI * 2 / n;
               let localAngle = (angle % step);
               if (localAngle < 0) localAngle += step;
               if (localAngle > step / 2) localAngle = step - localAngle;
               const alpha = localAngle;
               const R_out = radius;
               const R_in = R_out * 0.5;
               const gamma = step / 2;
               const m = (R_in * Math.sin(gamma)) / (R_in * Math.cos(gamma) - R_out);
               const maxR = (-m * R_out) / (Math.sin(alpha) - m * Math.cos(alpha));
               if (r < maxR) {
                   dist = (r / maxR) * radius;
                   isInside = true;
               }
          } else {
              // Circle
              const distSq = dx * dx + dz * dz
              if (distSq < radius * radius) {
                  dist = Math.sqrt(distSq)
                  isInside = true
              }
          }

          if (isInside) {
              let influence = Math.cos((dist / radius) * (Math.PI / 2))
              
              const noiseVal = sculptNoise(x * 0.05, z * 0.05, 0)
              const realismFactor = 1.0 + noiseVal * 0.1
              influence *= realismFactor

              const factor = isDigging ? -1 : 1
              const offset = factor * strength * influence * 0.3

              const key = groundVertexKey(row, col)
              const currentHeight = definition.heightMap[key] ?? 0
              definition.heightMap[key] = currentHeight + offset
              modified = true
          }
      }
  }
  return modified
}

export function updateGroundGeometry(geometry: THREE.BufferGeometry, definition: GroundDynamicMesh): boolean {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const expectedVertexCount = vertexColumns * vertexRows

  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined

  if (!positionAttr || positionAttr.count !== expectedVertexCount || !uvAttr || uvAttr.count !== expectedVertexCount) {
    return false
  }

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0

      positionAttr.setXYZ(vertexIndex, x, height, z)
      uvAttr.setXY(vertexIndex, columns === 0 ? 0 : column / columns, rows === 0 ? 0 : 1 - row / rows)
      vertexIndex += 1
    }
  }

  positionAttr.needsUpdate = true
  uvAttr.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

function disposeGroundTexture(texture: THREE.Texture | undefined) {
  if (texture) {
    texture.dispose()
  }
}

function applyGroundTexture(mesh: THREE.Mesh, definition: GroundDynamicMesh) {
  const material = mesh.material as THREE.MeshStandardMaterial
  if (!material || Array.isArray(material)) {
    return
  }

  const previousTexture = mesh.userData.groundTexture as THREE.Texture | undefined
  const wasDynamicTextureApplied = Boolean(previousTexture && material.map === previousTexture)
  if (previousTexture) {
    disposeGroundTexture(previousTexture)
    delete mesh.userData.groundTexture
  }

  if (!definition.textureDataUrl) {
    if (wasDynamicTextureApplied) {
      material.map = null
      material.needsUpdate = true
    }
    return
  }

  const texture = textureLoader.load(definition.textureDataUrl, () => {
    material.needsUpdate = true
  })
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = Math.min(16, texture.anisotropy || 8)
  texture.name = definition.textureName ?? 'GroundTexture'
  material.map = texture
  material.needsUpdate = true
  mesh.userData.groundTexture = texture
}

export function createGroundMesh(definition: GroundDynamicMesh): THREE.Mesh {
  if (!cachedMesh) {
    const geometry = buildGroundGeometry(definition)
    const material = new THREE.MeshStandardMaterial({
      color: '#707070',
      roughness: 0.85,
      metalness: 0.05,
    })
    cachedMesh = new THREE.Mesh(geometry, material)
    cachedMesh.name = 'Ground'
    cachedMesh.receiveShadow = true
    cachedMesh.castShadow = false
  cachedMesh.userData.dynamicMeshType = 'Ground'
    applyGroundTexture(cachedMesh, definition)
    return cachedMesh
  }

  updateGroundMesh(cachedMesh, definition)
  cachedMesh.name = 'Ground'
  cachedMesh.receiveShadow = true
  cachedMesh.castShadow = false
  cachedMesh.userData.dynamicMeshType = 'Ground'
  return cachedMesh
}

export function updateGroundMesh(mesh: THREE.Mesh, definition: GroundDynamicMesh) {
  if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
    mesh.geometry = buildGroundGeometry(definition)
  }
  const bufferGeometry = mesh.geometry as THREE.BufferGeometry
  const updated = updateGroundGeometry(bufferGeometry, definition)
  if (!updated) {
    bufferGeometry.dispose()
    mesh.geometry = buildGroundGeometry(definition)
  }
  applyGroundTexture(mesh, definition)
}

export function releaseGroundMeshCache(disposeResources = true) {
  if (!cachedMesh) {
    return
  }

  cachedMesh.removeFromParent()

  if (disposeResources) {
    const geometry = cachedMesh.geometry
    if (geometry) {
      geometry.dispose()
    }
    const material = cachedMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else if (material) {
      material.dispose()
    }
    disposeGroundTexture(cachedMesh.userData.groundTexture as THREE.Texture | undefined)
    delete cachedMesh.userData.groundTexture
  }

  cachedMesh = null
}
