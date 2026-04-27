import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import type { DemImportResult } from './dem'

export type TerrainBuildResult = {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  vertexCount: number
  triangleCount: number
  boundsWidth: number
  boundsDepth: number
  heights: Float32Array
}

export function buildTerrainMesh(result: DemImportResult, verticalScale = 1): TerrainBuildResult {
  const width = Math.max(1, Math.floor(result.width))
  const height = Math.max(1, Math.floor(result.height))
  const widthSegments = Math.max(0, width - 1)
  const heightSegments = Math.max(0, height - 1)
  const boundsWidth = Math.max(1, result.worldBounds ? Math.abs(result.worldBounds.maxX - result.worldBounds.minX) : width - 1)
  const boundsDepth = Math.max(1, result.worldBounds ? Math.abs(result.worldBounds.maxZ - result.worldBounds.minZ) : height - 1)
  const halfWidth = boundsWidth * 0.5
  const halfDepth = boundsDepth * 0.5
  const positions = new Float32Array(width * height * 3)
  const colors = new Float32Array(width * height * 3)
  const heights = new Float32Array(width * height)
  const minHeight = result.minElevation ?? 0
  const maxHeight = result.maxElevation ?? 1
  const heightRange = Math.max(1e-6, maxHeight - minHeight)

  let offset = 0
  for (let row = 0; row < height; row += 1) {
    const rowFactor = height <= 1 ? 0 : row / (height - 1)
    const z = halfDepth - rowFactor * boundsDepth
    for (let column = 0; column < width; column += 1) {
      const columnFactor = width <= 1 ? 0 : column / (width - 1)
      const x = -halfWidth + columnFactor * boundsWidth
      const sourceIndex = row * width + column
      const elevation = Number(result.rasterData[sourceIndex])
      const normalized = Number.isFinite(elevation) ? Math.max(0, Math.min(1, (elevation - minHeight) / heightRange)) : 0
      const y = Number.isFinite(elevation) ? elevation * verticalScale : 0
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = z
      heights[sourceIndex] = y

      const low = new THREE.Color('#0b2a3d')
      const mid = new THREE.Color('#4f7a5b')
      const high = new THREE.Color('#f5deb3')
      const color = normalized < 0.5
        ? low.clone().lerp(mid, normalized * 2)
        : mid.clone().lerp(high, (normalized - 0.5) * 2)
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
      offset += 3
    }
  }

  const indices = new Uint32Array(widthSegments * heightSegments * 6)
  let indexOffset = 0
  for (let row = 0; row < heightSegments; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const a = row * width + column
      const b = a + 1
      const c = a + width
      const d = c + 1
      indices[indexOffset] = a
      indices[indexOffset + 1] = b
      indices[indexOffset + 2] = c
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = d
      indices[indexOffset + 5] = c
      indexOffset += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = true

  return {
    mesh,
    geometry,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    boundsWidth,
    boundsDepth,
    heights,
  }
}

export function exportTerrainAsObj(mesh: THREE.Mesh): string {
  const exporter = new OBJExporter()
  const output = exporter.parse(mesh)
  return typeof output === 'string' ? output : String(output)
}

export function exportTerrainAsPly(mesh: THREE.Mesh): string {
  const exporter = new PLYExporter()
  const output = exporter.parse(mesh, undefined, { binary: false })
  return typeof output === 'string' ? output : new TextDecoder().decode(output)
}

export function exportTerrainAsJson(result: DemImportResult, terrain: TerrainBuildResult): string {
  const geometry = terrain.geometry
  const positions = geometry.getAttribute('position')
  const colors = geometry.getAttribute('color')
  return JSON.stringify({
    source: {
      filename: result.filename,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      minElevation: result.minElevation,
      maxElevation: result.maxElevation,
      geographicBounds: result.geographicBounds,
      worldBounds: result.worldBounds,
    },
    terrain: {
      vertexCount: terrain.vertexCount,
      triangleCount: terrain.triangleCount,
      boundsWidth: terrain.boundsWidth,
      boundsDepth: terrain.boundsDepth,
      positions: Array.from(positions.array as ArrayLike<number>),
      colors: Array.from(colors.array as ArrayLike<number>),
      heights: Array.from(terrain.heights),
    },
  }, null, 2)
}
