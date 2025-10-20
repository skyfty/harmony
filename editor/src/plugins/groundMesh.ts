import * as THREE from 'three'
import type { GroundDynamicMesh } from '@/types/dynamic-mesh'

const textureLoader = new THREE.TextureLoader()

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

function updateGroundGeometry(geometry: THREE.BufferGeometry, definition: GroundDynamicMesh): boolean {
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
  if (previousTexture) {
    disposeGroundTexture(previousTexture)
    delete mesh.userData.groundTexture
  }

  if (!definition.textureDataUrl) {
    material.map = null
    material.needsUpdate = true
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
  const geometry = buildGroundGeometry(definition)
  const material = new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 0.85,
    metalness: 0.05,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Ground'
  mesh.receiveShadow = true
  mesh.castShadow = false
  applyGroundTexture(mesh, definition)
  mesh.userData.dynamicMeshType = 'ground'
  return mesh
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
