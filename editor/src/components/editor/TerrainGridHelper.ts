import * as THREE from 'three'
import type { GroundDynamicMesh } from '@harmony/schema'
import { GRID_MAJOR_SPACING, GRID_MINOR_SPACING } from './constants'

const MIN_LINE_WIDTH = 0.008
const MAJOR_LINE_WIDTH = 0.011
const MINOR_LINE_FEATHER = 0.003
const MAJOR_LINE_FEATHER = 0.0045
const MIN_LINE_COLOR = new THREE.Color(0x7dd8ff)
const MAJOR_LINE_COLOR = new THREE.Color(0x1c5ba1)
const BASE_LINE_OPACITY = 0.88

function buildTerrainGeometry(definition: GroundDynamicMesh): THREE.BufferGeometry {
  const columns = Math.max(1, Math.floor(definition.columns))
  const rows = Math.max(1, Math.floor(definition.rows))
  const cellSize = Math.max(1e-4, definition.cellSize)
  const width = Math.max(Math.abs(definition.width), columns * cellSize)
  const depth = Math.max(Math.abs(definition.depth), rows * cellSize)
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  const heightMap = definition.heightMap ?? {}

  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const vertexCount = vertexColumns * vertexRows

  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  let positionOffset = 0
  let uvOffset = 0

  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = `${row}:${column}`
      const height = heightMap[key] ?? 0
      positions[positionOffset + 0] = x
      positions[positionOffset + 1] = height
      positions[positionOffset + 2] = z
      positionOffset += 3

      uvs[uvOffset + 0] = columns === 0 ? 0 : column / columns
      uvs[uvOffset + 1] = rows === 0 ? 0 : 1 - row / rows
      uvOffset += 2
    }
  }

  const indices = new Uint32Array(columns * rows * 6)
  let indexOffset = 0

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1
      indices[indexOffset + 0] = a
      indices[indexOffset + 1] = c
      indices[indexOffset + 2] = b
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = c
      indices[indexOffset + 5] = d
      indexOffset += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function createShaderMaterial(): THREE.ShaderMaterial {
  const vertexShader = `
    varying vec3 vWorldPosition;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `

  const fragmentShader = `
    precision highp float;
    uniform float minorSpacing;
    uniform float majorSpacing;
    uniform float minorWidth;
    uniform float majorWidth;
    uniform float minorFeather;
    uniform float majorFeather;
    uniform vec3 minorColor;
    uniform vec3 majorColor;
    uniform float opacity;

    varying vec3 vWorldPosition;

    float distanceToLine(float value, float spacing) {
      if (spacing <= 0.0) {
        return 1.0;
      }
      float wrapped = mod(abs(value), spacing);
      float dist = min(wrapped, spacing - wrapped);
      return dist;
    }

    float computeScreenScale(float axisX, float axisZ) {
      float derivative = max(fwidth(axisX), fwidth(axisZ));
      float invDerivative = 1.0 / max(derivative, 0.0001);
      return clamp(invDerivative, 0.7, 2.5);
    }

    float gridMask(float spacing, float baseWidth, float baseFeather, float axisX, float axisZ) {
      if (spacing <= 0.0) {
        return 0.0;
      }
      float scale = computeScreenScale(axisX, axisZ);
      float width = baseWidth * scale;
      float feather = baseFeather * scale;
      float distX = distanceToLine(axisX, spacing);
      float distZ = distanceToLine(axisZ, spacing);
      float dist = min(distX, distZ);
      return 1.0 - smoothstep(width, width + feather, dist);
    }

    void main() {
      float minorMask = gridMask(minorSpacing, minorWidth, minorFeather, vWorldPosition.x, vWorldPosition.z);
      float majorMask = gridMask(majorSpacing, majorWidth, majorFeather, vWorldPosition.x, vWorldPosition.z);
      float finalMask = max(minorMask * 0.84, majorMask);
      if (finalMask <= 0.0) {
        discard;
      }
      vec3 color = minorColor;
      if (majorMask > minorMask) {
        color = majorColor;
      }
      gl_FragColor = vec4(color, finalMask * opacity);
    }
  `

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
      uniforms: {
        minorSpacing: { value: GRID_MINOR_SPACING },
        majorSpacing: { value: GRID_MAJOR_SPACING },
        minorWidth: { value: MIN_LINE_WIDTH },
        majorWidth: { value: MAJOR_LINE_WIDTH },
        minorFeather: { value: MINOR_LINE_FEATHER },
        majorFeather: { value: MAJOR_LINE_FEATHER },
        minorColor: { value: MIN_LINE_COLOR },
        majorColor: { value: MAJOR_LINE_COLOR },
        opacity: { value: BASE_LINE_OPACITY },
      },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 1,
  })
}

export class TerrainGridHelper extends THREE.Object3D {
  private mesh: THREE.Mesh | null = null
  private material: THREE.ShaderMaterial
  private signature: string | null = null

  constructor() {
    super()
    this.material = createShaderMaterial()
    this.name = 'TerrainGridHelper'
  }

  update(definition: GroundDynamicMesh | null, nextSignature: string | null) {
    if (!definition) {
      this.signature = null
      if (this.mesh) {
        this.mesh.visible = false
      }
      return
    }

    if (nextSignature && nextSignature === this.signature) {
      if (this.mesh) {
        this.mesh.visible = true
      }
      return
    }

    this.signature = nextSignature
    const geometry = buildTerrainGeometry(definition)
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geometry, this.material)
      this.mesh.frustumCulled = false
      this.mesh.name = 'TerrainGridMesh'
      this.add(this.mesh)
    } else {
      this.mesh.geometry?.dispose()
      this.mesh.geometry = geometry
      this.mesh.visible = true
    }
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry?.dispose()
      this.mesh.removeFromParent()
      this.mesh = null
    }
    this.material.dispose()
  }
}
