import * as THREE from 'three'
import type { SceneOutlineMesh } from '@harmony/schema'
import { buildOutlineMeshFromObject } from '@/utils/outlineMesh'

export type ConvexSimplifyPass = {
  pointTarget: number
  decimalPrecision: number
  vertexMergeTolerance: number
  inflate: number
}

export type ConvexSimplifyLimits = {
  maxVertices: number
  maxFaces: number
}

export type ConvexSimplifyConfigV1 = {
  version: 1
  primary: ConvexSimplifyPass
  fallback: ConvexSimplifyPass
  limits: ConvexSimplifyLimits
}

export const DEFAULT_CONVEX_SIMPLIFY_CONFIG: ConvexSimplifyConfigV1 = {
  version: 1,
  primary: {
    pointTarget: 128,
    decimalPrecision: 2,
    vertexMergeTolerance: 2e-3,
    inflate: 0.02,
  },
  fallback: {
    pointTarget: 64,
    decimalPrecision: 2,
    vertexMergeTolerance: 6e-3,
    inflate: 0.03,
  },
  limits: {
    maxVertices: 128,
    maxFaces: 256,
  },
}

function quantize(value: number, decimalPrecision: number): number {
  const quantizeFactor = 10 ** decimalPrecision
  const scaled = Math.round(value * quantizeFactor) / quantizeFactor
  return Object.is(scaled, -0) ? 0 : scaled
}

export function inflateOutlinePositions(
  outline: SceneOutlineMesh,
  options: { inflate: number; decimalPrecision: number },
): SceneOutlineMesh {
  const inflate = Number.isFinite(options.inflate) ? options.inflate : 0
  if (inflate <= 0) {
    return outline
  }
  const positions = Array.isArray(outline.positions) ? outline.positions : []
  if (positions.length < 12) {
    return outline
  }

  let cx = 0
  let cy = 0
  let cz = 0
  const count = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i] ?? 0
    cy += positions[i + 1] ?? 0
    cz += positions[i + 2] ?? 0
  }
  cx /= count
  cy /= count
  cz /= count

  const scale = 1 + inflate
  const out: number[] = new Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] ?? cx
    const py = positions[i + 1] ?? cy
    const pz = positions[i + 2] ?? cz
    const x = cx + (px - cx) * scale
    const y = cy + (py - cy) * scale
    const z = cz + (pz - cz) * scale
    out[i] = quantize(x, options.decimalPrecision)
    out[i + 1] = quantize(y, options.decimalPrecision)
    out[i + 2] = quantize(z, options.decimalPrecision)
  }

  return {
    ...outline,
    positions: out,
  }
}

export function buildConvexGeometryFromOutline(outline: SceneOutlineMesh): THREE.BufferGeometry | null {
  const positions = Array.isArray(outline.positions) ? outline.positions : []
  if (positions.length < 12) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

  const indices = Array.isArray(outline.indices) ? outline.indices : []
  if (indices.length >= 3) {
    geometry.setIndex(indices)
  } else {
    const fallback: number[] = []
    for (let index = 0; index + 2 < positions.length / 3; index += 3) {
      fallback.push(index, index + 1, index + 2)
    }
    geometry.setIndex(fallback)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function buildConservativeConvexGeometryFromObject(
  object: THREE.Object3D,
  pass: ConvexSimplifyPass,
): { geometry: THREE.BufferGeometry; outline: SceneOutlineMesh } | null {
  const outline = buildOutlineMeshFromObject(object, {
    pointTarget: pass.pointTarget,
    decimalPrecision: pass.decimalPrecision,
    vertexMergeTolerance: pass.vertexMergeTolerance,
  })
  if (!outline) {
    return null
  }
  const inflated = inflateOutlinePositions(outline, {
    inflate: pass.inflate,
    decimalPrecision: pass.decimalPrecision,
  })
  const geometry = buildConvexGeometryFromOutline(inflated)
  if (!geometry) {
    return null
  }
  return { geometry, outline: inflated }
}

export function geometryStats(geometry: THREE.BufferGeometry): { vertices: number; faces: number } {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const vertices = positionAttr?.count ?? 0
  const index = geometry.getIndex()
  const faces = index ? Math.floor(index.count / 3) : Math.max(0, vertices - 2)
  return { vertices, faces }
}
