import { normalizeCannonConvexHullData } from '../dist/shapeFactory.js'

const cubeVertices = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
]

const noisyFaces = [
  [3, 2, 1, 0],
  [5, 6, 7, 4],
  [1, 5, 5, 4, 0],
  [2, 6, 5, 1],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [0, 99, 1],
  [0, 0],
]

const polyhedron = normalizeCannonConvexHullData(cubeVertices, noisyFaces, {
  loggerTag: '[ConvexRegression]',
})

if (!polyhedron) {
  throw new Error('Expected convex polyhedron to be created')
}

if (polyhedron.vertices.length !== 8) {
  throw new Error(`Expected 8 deduped vertices, received ${polyhedron.vertices.length}`)
}

if (polyhedron.faces.length !== 6) {
  throw new Error(`Expected 6 sanitized faces, received ${polyhedron.faces.length}`)
}

const centroid = { x: 0, y: 0, z: 0 }
for (const vertex of polyhedron.vertices) {
  centroid.x += vertex.x
  centroid.y += vertex.y
  centroid.z += vertex.z
}
centroid.x /= polyhedron.vertices.length
centroid.y /= polyhedron.vertices.length
centroid.z /= polyhedron.vertices.length

for (const face of polyhedron.faces) {
  if (!Array.isArray(face) || face.length < 3) {
    throw new Error('Encountered malformed face after sanitization')
  }
  const a = polyhedron.vertices[face[0]]
  const b = polyhedron.vertices[face[1]]
  const c = polyhedron.vertices[face[2]]
  if (!a || !b || !c) {
    throw new Error('Encountered invalid face index after sanitization')
  }
  const ab = {
    x: b.x - a.x,
    y: b.y - a.y,
    z: b.z - a.z,
  }
  const ac = {
    x: c.x - a.x,
    y: c.y - a.y,
    z: c.z - a.z,
  }
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  }
  const fromCentroid = {
    x: a.x - centroid.x,
    y: a.y - centroid.y,
    z: a.z - centroid.z,
  }
  const dot = normal.x * fromCentroid.x + normal.y * fromCentroid.y + normal.z * fromCentroid.z
  if (!(dot >= 0)) {
    throw new Error(`Expected outward-facing face orientation, received inward face ${JSON.stringify(face)}`)
  }
}

console.log('convex-regression: ok')
