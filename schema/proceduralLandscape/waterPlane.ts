import * as THREE from 'three'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { getSlowroadsWaterEnvironment } from '../slowroads/render/environmentRuntime'
import {
  landscapeExclusionSignature,
  type LandscapeExclusionCircle,
} from './exclusion'
import type { TerrainHeightGrid } from './terrainSampler'

/**
 * Flat water surface using the Slow Roads 2.4.2 water response.
 *
 * The source scene uses a depth attribute per sea tile. A real DEM can span
 * hundreds of source tiles, so this port stores the same terrain-relative depth
 * in a compact RGBA height texture and samples it in the fragment shader. The
 * existing triangulated exclusion holes are retained.
 */

const WATER_HEIGHT_TEXTURE_MAX_SIZE = 256
export const WATER_DEPTH_DISCARD_METERS = 10
export const WATER_SHALLOW_DEPTH_METERS = 5

export interface WaterTerrainHeightField {
  texture: THREE.DataTexture
  width: number
  height: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
  bytes: number
}

export interface WaterPlaneOptions {
  /** Square plane size in meters. */
  worldSize: number
  centerX: number
  centerZ: number
  waterLevel: number
  waves: THREE.Texture
  terrainGrid?: TerrainHeightGrid | null
  exclusionCircles?: ReadonlyArray<LandscapeExclusionCircle>
}

export interface WaterPlaneHandle {
  mesh: THREE.Mesh
  readonly worldSize: number
  readonly depthTextureBytes: number
  setWaterLevel(level: number): void
  setWavesTexture(texture: THREE.Texture): void
  setTerrainGrid(grid: TerrainHeightGrid | null): void
  setExclusionCircles(circles: ReadonlyArray<LandscapeExclusionCircle>): void
  setDebugMode(mode: number): void
  update(): void
  setVisible(visible: boolean): void
  dispose(): void
}

const VERTEX_SHADER = `
#include <common>
uniform float uTime;
varying vec3 vWorldPosition;
varying vec2 vWaveUvA;
varying vec2 vWaveUvB;
varying vec2 vWaveUvC;
varying float vViewDistance;
#include <fog_pars_vertex>
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWaveUvA = (worldPosition.xz + vec2(uTime)) / 200.0;
  vWaveUvB = (worldPosition.xz - vec2(uTime)) / 800.0;
  vWaveUvC = (worldPosition.xz - vec2(uTime)) / 300.0;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uWaves;
uniform sampler2D uTerrainHeightMap;
uniform vec3 uBase;
uniform vec3 uBody;
uniform vec3 uHighlight;
uniform vec2 uTerrainBoundsMin;
uniform vec2 uTerrainBoundsSize;
uniform vec2 uTerrainTextureSize;
uniform float uTerrainHeightMin;
uniform float uTerrainHeightRange;
uniform float uWaterLevel;
uniform float uHasTerrainDepth;
uniform float uFrozen;
uniform int uDebugMode;
varying vec3 vWorldPosition;
varying vec2 vWaveUvA;
varying vec2 vWaveUvB;
varying vec2 vWaveUvC;
varying float vViewDistance;
#include <fog_pars_fragment>

vec4 sampleWaterHeightTexel(vec2 coord) {
  vec2 limit = max(vec2(0.0), uTerrainTextureSize - 1.0);
  vec2 safeCoord = clamp(floor(coord + 0.5), vec2(0.0), limit);
  return texture2D(uTerrainHeightMap, (safeCoord + 0.5) / uTerrainTextureSize);
}

float decodePackedHeight(vec4 texel) {
  float high = floor(texel.r * 255.0 + 0.5);
  float low = floor(texel.g * 255.0 + 0.5);
  float normalized = (high * 256.0 + low) / 65535.0;
  return uTerrainHeightMin + normalized * uTerrainHeightRange;
}

void main() {
  if (uDebugMode == 9) {
    gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  float terrainDepth = 0.0;
  float terrainCoverage = 1.0;
  if (uHasTerrainDepth > 0.5) {
    vec2 depthUv = (vWorldPosition.xz - uTerrainBoundsMin)
      / max(uTerrainBoundsSize, vec2(0.0001));
    if (any(lessThan(depthUv, vec2(0.0))) || any(greaterThan(depthUv, vec2(1.0)))) {
      discard;
    }

    vec2 texelPosition = depthUv * max(vec2(1.0), uTerrainTextureSize - 1.0);
    vec2 baseCoord = floor(texelPosition);
    vec2 blend = fract(texelPosition);
    vec4 texel00 = sampleWaterHeightTexel(baseCoord);
    vec4 texel10 = sampleWaterHeightTexel(baseCoord + vec2(1.0, 0.0));
    vec4 texel01 = sampleWaterHeightTexel(baseCoord + vec2(0.0, 1.0));
    vec4 texel11 = sampleWaterHeightTexel(baseCoord + vec2(1.0, 1.0));

    float height00 = decodePackedHeight(texel00);
    float height10 = decodePackedHeight(texel10);
    float height01 = decodePackedHeight(texel01);
    float height11 = decodePackedHeight(texel11);
    float terrainHeight = mix(
      mix(height00, height10, blend.x),
      mix(height01, height11, blend.x),
      blend.y
    );
    terrainCoverage = mix(
      mix(floor(texel00.b * 255.0 + 0.5), floor(texel10.b * 255.0 + 0.5), blend.x),
      mix(floor(texel01.b * 255.0 + 0.5), floor(texel11.b * 255.0 + 0.5), blend.x),
      blend.y
    ) / 255.0;
    if (terrainCoverage < 0.5) {
      discard;
    }
    terrainDepth = terrainHeight - uWaterLevel;
    if (terrainDepth > ${WATER_DEPTH_DISCARD_METERS.toFixed(1)}) {
      discard;
    }
  }

  float wave1 = texture2D(uWaves, vWaveUvA).r + 0.1;
  float wave2 = texture2D(uWaves, vWaveUvB).r + 0.1;
  float wave4 = texture2D(uWaves, vWaveUvC).r + 0.1;
  float wave5 = texture2D(uWaves, vWaveUvB - vWaveUvA).r + 0.1;

  float seaDot = dot(
    normalize(cameraPosition - vWorldPosition),
    vec3(0.0, 1.0, 0.0)
  );
  float waveScale = 1.0 - uFrozen * 0.8;
  seaDot += wave4 * wave5 * 0.5 * waveScale;
  seaDot -= wave1 * wave2 * waveScale;
  seaDot = clamp(seaDot, 0.0, 1.0);

  vec3 color = mix(uBase, uBody, pow(1.0 - seaDot, 2.0));
  if (terrainDepth < 0.0) {
    color *= 1.0 - min(1.0, terrainDepth / -15.0) * 0.3;
  }
  if (terrainDepth > -${WATER_SHALLOW_DEPTH_METERS.toFixed(1)}) {
    seaDot *= 0.7 + 0.3 * (terrainDepth / -${WATER_SHALLOW_DEPTH_METERS.toFixed(1)});
  }
  float sunDotMix = seaDot < 0.125 ? 1.0 - seaDot * 8.0 : 0.0;
  color = mix(color, uHighlight, sunDotMix * sunDotMix);

  color = mix(
    color,
    mix(vec3(0.80, 0.84, 0.87), uHighlight, 0.25),
    uFrozen * 0.85
  );

  if (uDebugMode == 1) {
    color = terrainDepth < 0.0
      ? vec3(0.05, 0.20, 0.85)
      : vec3(0.75, 0.32, 0.08);
  } else if (uDebugMode == 2) {
    color = vec3(terrainCoverage);
  } else if (uDebugMode == 3) {
    color = vec3(seaDot);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

function createWaterGeometry(
  worldSize: number,
  centerX: number,
  centerZ: number,
  exclusionCircles: ReadonlyArray<LandscapeExclusionCircle>,
): THREE.ShapeGeometry {
  const half = worldSize * 0.5
  const shape = new THREE.Shape()
  shape.moveTo(-half, -half)
  shape.lineTo(half, -half)
  shape.lineTo(half, half)
  shape.lineTo(-half, half)
  shape.closePath()

  for (const circle of exclusionCircles) {
    const localX = circle.centerX - centerX
    const localY = -(circle.centerZ - centerZ)
    if (
      !Number.isFinite(localX)
      || !Number.isFinite(localY)
      || !Number.isFinite(circle.radius)
      || circle.radius <= 0
      || Math.abs(localX) + circle.radius >= half
      || Math.abs(localY) + circle.radius >= half
    ) {
      continue
    }
    const hole = new THREE.Path()
    const segments = Math.max(32, Math.min(128, Math.ceil(circle.radius * 2)))
    for (let index = 0; index < segments; index += 1) {
      const angle = -(index / segments) * Math.PI * 2
      const x = localX + Math.cos(angle) * circle.radius
      const y = localY + Math.sin(angle) * circle.radius
      if (index === 0) {
        hole.moveTo(x, y)
      } else {
        hole.lineTo(x, y)
      }
    }
    hole.closePath()
    shape.holes.push(hole)
  }
  return new THREE.ShapeGeometry(shape, 1)
}

function createFallbackHeightField(): WaterTerrainHeightField {
  const texture = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'procedural-landscape-water-height-fallback'
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return {
    texture,
    width: 1,
    height: 1,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    minY: 0,
    maxY: 0,
    bytes: 4,
  }
}

export function createWaterTerrainHeightField(
  grid: TerrainHeightGrid,
  maxSamplesPerAxis = WATER_HEIGHT_TEXTURE_MAX_SIZE,
): WaterTerrainHeightField {
  const requested = Number.isFinite(maxSamplesPerAxis)
    ? Math.round(maxSamplesPerAxis)
    : WATER_HEIGHT_TEXTURE_MAX_SIZE
  const maxSize = Math.max(2, Math.min(512, requested))
  const width = Math.max(2, Math.min(maxSize, grid.cols))
  const height = Math.max(2, Math.min(maxSize, grid.rows))
  const data = new Uint8Array(width * height * 4)
  const range = Math.max(0.001, grid.maxY - grid.minY)

  for (let row = 0; row < height; row += 1) {
    const v = height <= 1 ? 0 : row / (height - 1)
    const z = grid.minZ + (grid.maxZ - grid.minZ) * v
    for (let col = 0; col < width; col += 1) {
      const u = width <= 1 ? 0 : col / (width - 1)
      const x = grid.minX + (grid.maxX - grid.minX) * u
      const terrainHeight = grid.sampleHeight(x, z)
      const offset = (row * width + col) * 4
      if (terrainHeight == null || !Number.isFinite(terrainHeight)) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 255
        continue
      }
      const normalized = Math.max(0, Math.min(1, (terrainHeight - grid.minY) / range))
      const packed = Math.round(normalized * 65535)
      data[offset] = (packed >>> 8) & 0xff
      data[offset + 1] = packed & 0xff
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = 'procedural-landscape-water-height'
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true

  return {
    texture,
    width,
    height,
    minX: grid.minX,
    maxX: grid.maxX,
    minZ: grid.minZ,
    maxZ: grid.maxZ,
    minY: grid.minY,
    maxY: grid.maxY,
    bytes: data.byteLength,
  }
}

export function createWaterPlane(options: WaterPlaneOptions): WaterPlaneHandle {
  let exclusionCircles = (options.exclusionCircles ?? []).slice()
  let exclusionSignature = landscapeExclusionSignature(exclusionCircles)
  let terrainGrid = options.terrainGrid ?? null
  let terrainField = terrainGrid
    ? createWaterTerrainHeightField(terrainGrid)
    : createFallbackHeightField()
  let geometry = createWaterGeometry(
    options.worldSize,
    options.centerX,
    options.centerZ,
    exclusionCircles,
  )

  const waves = options.waves
  waves.wrapS = THREE.RepeatWrapping
  waves.wrapT = THREE.RepeatWrapping

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uWaves: { value: waves },
      uTerrainHeightMap: { value: terrainField.texture },
      uBase: { value: new THREE.Color(0x283743) },
      uBody: { value: new THREE.Color(0x5b7395) },
      uHighlight: { value: new THREE.Color(0x9ac4fe) },
      uTerrainBoundsMin: { value: new THREE.Vector2(terrainField.minX, terrainField.minZ) },
      uTerrainBoundsSize: {
        value: new THREE.Vector2(
          Math.max(0.001, terrainField.maxX - terrainField.minX),
          Math.max(0.001, terrainField.maxZ - terrainField.minZ),
        ),
      },
      uTerrainTextureSize: {
        value: new THREE.Vector2(terrainField.width, terrainField.height),
      },
      uTerrainHeightMin: { value: terrainField.minY },
      uTerrainHeightRange: {
        value: Math.max(0.001, terrainField.maxY - terrainField.minY),
      },
      uWaterLevel: { value: options.waterLevel },
      uHasTerrainDepth: { value: terrainGrid ? 1 : 0 },
      uTime: { value: 0 },
      uFrozen: { value: 0 },
      uDebugMode: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  })
  material.name = 'slowroads-water-material'
  material.onBeforeCompile = (shader) => {
    injectSlowroadsFog(shader, { base: 'color-space', material })
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(options.centerX, options.waterLevel, options.centerZ)
  mesh.name = 'slowroads-water'
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.frustumCulled = false
  mesh.userData.proceduralLandscapeWaterDepthTextureBytes = terrainField.bytes

  function applyTerrainField(next: WaterTerrainHeightField, hasTerrainDepth: boolean): void {
    const previous = terrainField
    terrainField = next
    material.uniforms.uTerrainHeightMap!.value = next.texture
    ;(material.uniforms.uTerrainBoundsMin!.value as THREE.Vector2)
      .set(next.minX, next.minZ)
    ;(material.uniforms.uTerrainBoundsSize!.value as THREE.Vector2)
      .set(
        Math.max(0.001, next.maxX - next.minX),
        Math.max(0.001, next.maxZ - next.minZ),
      )
    ;(material.uniforms.uTerrainTextureSize!.value as THREE.Vector2)
      .set(next.width, next.height)
    material.uniforms.uTerrainHeightMin!.value = next.minY
    material.uniforms.uTerrainHeightRange!.value = Math.max(0.001, next.maxY - next.minY)
    material.uniforms.uHasTerrainDepth!.value = hasTerrainDepth ? 1 : 0
    mesh.userData.proceduralLandscapeWaterDepthTextureBytes = next.bytes
    if (previous.texture !== next.texture) {
      previous.texture.dispose()
    }
  }

  return {
    mesh,
    get worldSize(): number {
      return options.worldSize
    },
    get depthTextureBytes(): number {
      return terrainField.bytes
    },
    setWaterLevel(level: number): void {
      mesh.position.y = level
      material.uniforms.uWaterLevel!.value = level
    },
    setWavesTexture(texture: THREE.Texture): void {
      if (material.uniforms.uWaves!.value === texture) {
        return
      }
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      material.uniforms.uWaves!.value = texture
      material.needsUpdate = true
    },
    setTerrainGrid(grid: TerrainHeightGrid | null): void {
      if (terrainGrid === grid) {
        return
      }
      terrainGrid = grid
      applyTerrainField(
        grid ? createWaterTerrainHeightField(grid) : createFallbackHeightField(),
        Boolean(grid),
      )
    },
    setExclusionCircles(circles: ReadonlyArray<LandscapeExclusionCircle>): void {
      const nextSignature = landscapeExclusionSignature(circles)
      if (nextSignature === exclusionSignature) {
        return
      }
      exclusionCircles = circles.slice()
      exclusionSignature = nextSignature
      const nextGeometry = createWaterGeometry(
        options.worldSize,
        options.centerX,
        options.centerZ,
        exclusionCircles,
      )
      mesh.geometry = nextGeometry
      geometry.dispose()
      geometry = nextGeometry
    },
    setDebugMode(mode: number): void {
      material.uniforms.uDebugMode!.value = Number.isFinite(mode) ? Math.round(mode) : 0
    },
    update(): void {
      const state = getSlowroadsWaterEnvironment()
      if (!state) {
        return
      }
      material.uniforms.uBase!.value.set(state.base)
      material.uniforms.uBody!.value.set(state.body)
      material.uniforms.uHighlight!.value.set(state.highlight)
      material.uniforms.uTime!.value = state.timeSeconds
      material.uniforms.uFrozen!.value = state.frozen ? 1 : 0
    },
    setVisible(visible: boolean): void {
      mesh.visible = visible
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      terrainField.texture.dispose()
      material.dispose()
    },
  }
}
