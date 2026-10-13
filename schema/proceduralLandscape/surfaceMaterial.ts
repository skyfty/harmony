import * as THREE from 'three'

/**
 * slowroads-style terrain surface treatment.
 *
 * The GLB terrain keeps its own geometry, but each material is cloned and gets
 * a `onBeforeCompile` injection that:
 *  - displaces vertices towards the road profile (visual flattening), and
 *  - blends grass / forest canopy / rock / gravel / asphalt over the base map
 *    using the runtime road field + forest density textures.
 */
export interface ProceduralLandscapeSurfaceUniforms {
  uPlRoadField: THREE.IUniform<THREE.Texture | null>
  uPlForestMask: THREE.IUniform<THREE.Texture | null>
  uPlGrassVariation: THREE.IUniform<THREE.Texture | null>
  uPlGrassTex: THREE.IUniform<THREE.Texture | null>
  uPlForestTex: THREE.IUniform<THREE.Texture | null>
  uPlGravelTex: THREE.IUniform<THREE.Texture | null>
  uPlRoadTex: THREE.IUniform<THREE.Texture | null>
  uPlTerrainMin: THREE.IUniform<THREE.Vector2>
  uPlTerrainSize: THREE.IUniform<THREE.Vector2>
  uPlHeightMin: THREE.IUniform<number>
  uPlHeightRange: THREE.IUniform<number>
  uPlRoadFieldRange: THREE.IUniform<number>
  uPlRoadHalfWidth: THREE.IUniform<number>
  uPlRoadShoulderWidth: THREE.IUniform<number>
  uPlSurfaceStrength: THREE.IUniform<number>
  uPlUvScale: THREE.IUniform<number>
  uPlGrassTint: THREE.IUniform<THREE.Color>
  uPlForestTint: THREE.IUniform<THREE.Color>
  uPlRoadTint: THREE.IUniform<THREE.Color>
  uPlGravelTint: THREE.IUniform<THREE.Color>
  uPlRockSlope: THREE.IUniform<number>
  uPlFlattenInner: THREE.IUniform<number>
  uPlFlattenOuter: THREE.IUniform<number>
  uPlFlattenStrength: THREE.IUniform<number>
  uPlHasGrass: THREE.IUniform<number>
  uPlHasForest: THREE.IUniform<number>
  uPlHasGravel: THREE.IUniform<number>
  uPlHasRoad: THREE.IUniform<number>
}

export function createProceduralLandscapeSurfaceUniforms(): ProceduralLandscapeSurfaceUniforms {
  return {
    uPlRoadField: { value: null },
    uPlForestMask: { value: null },
    uPlGrassVariation: { value: null },
    uPlGrassTex: { value: null },
    uPlForestTex: { value: null },
    uPlGravelTex: { value: null },
    uPlRoadTex: { value: null },
    uPlTerrainMin: { value: new THREE.Vector2(0, 0) },
    uPlTerrainSize: { value: new THREE.Vector2(1, 1) },
    uPlHeightMin: { value: 0 },
    uPlHeightRange: { value: 1 },
    uPlRoadFieldRange: { value: 64 },
    uPlRoadHalfWidth: { value: 3.5 },
    uPlRoadShoulderWidth: { value: 2.5 },
    uPlSurfaceStrength: { value: 1 },
    uPlUvScale: { value: 10 },
    uPlGrassTint: { value: new THREE.Color(1, 1, 1) },
    uPlForestTint: { value: new THREE.Color(1, 1, 1) },
    uPlRoadTint: { value: new THREE.Color(1, 1, 1) },
    uPlGravelTint: { value: new THREE.Color(1, 1, 1) },
    uPlRockSlope: { value: 0.35 },
    uPlFlattenInner: { value: 6 },
    uPlFlattenOuter: { value: 10 },
    uPlFlattenStrength: { value: 1 },
    uPlHasGrass: { value: 0 },
    uPlHasForest: { value: 0 },
    uPlHasGravel: { value: 0 },
    uPlHasRoad: { value: 0 },
  }
}

const VERTEX_HEADER = `#include <common>
uniform sampler2D uPlRoadField;
uniform vec2 uPlTerrainMin;
uniform vec2 uPlTerrainSize;
uniform float uPlHeightMin;
uniform float uPlHeightRange;
uniform float uPlRoadFieldRange;
uniform float uPlFlattenInner;
uniform float uPlFlattenOuter;
uniform float uPlFlattenStrength;
varying vec3 vPlWorldPosition;
varying vec3 vPlWorldNormal;`

const VERTEX_BODY = `#include <begin_vertex>
{
  vec4 plWorld4 = modelMatrix * vec4(transformed, 1.0);
  vPlWorldPosition = plWorld4.xyz;
  vPlWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vec2 plUv = (vPlWorldPosition.xz - uPlTerrainMin) / max(uPlTerrainSize, vec2(0.0001));
  vec4 plRoadSample = texture2D(uPlRoadField, plUv);
  float plDistance = plRoadSample.r * uPlRoadFieldRange;
  float plWeight = 1.0 - smoothstep(uPlFlattenInner, uPlFlattenOuter, plDistance);
  if (plWeight > 0.001 && uPlFlattenStrength > 0.0) {
    float plEncodedHeight = plRoadSample.g * 255.0 * 256.0 + plRoadSample.b * 255.0;
    float plTargetY = uPlHeightMin + (plEncodedHeight / 65535.0) * uPlHeightRange;
    float plScaleY = max(0.0001, length(vec3(modelMatrix[0][1], modelMatrix[1][1], modelMatrix[2][1])));
    float plDelta = (plTargetY - vPlWorldPosition.y) * plWeight * uPlFlattenStrength;
    transformed.y += plDelta / plScaleY;
    vPlWorldPosition.y += plDelta;
  }
}`

const FRAGMENT_HEADER = `#include <common>
uniform sampler2D uPlRoadField;
uniform sampler2D uPlForestMask;
uniform sampler2D uPlGrassVariation;
uniform sampler2D uPlGrassTex;
uniform sampler2D uPlForestTex;
uniform sampler2D uPlGravelTex;
uniform sampler2D uPlRoadTex;
uniform vec2 uPlTerrainMin;
uniform vec2 uPlTerrainSize;
uniform float uPlRoadFieldRange;
uniform float uPlRoadHalfWidth;
uniform float uPlRoadShoulderWidth;
uniform float uPlSurfaceStrength;
uniform float uPlUvScale;
uniform vec3 uPlGrassTint;
uniform vec3 uPlForestTint;
uniform vec3 uPlRoadTint;
uniform vec3 uPlGravelTint;
uniform float uPlRockSlope;
uniform float uPlHasGrass;
uniform float uPlHasForest;
uniform float uPlHasGravel;
uniform float uPlHasRoad;
varying vec3 vPlWorldPosition;
varying vec3 vPlWorldNormal;`

const FRAGMENT_BODY = `#include <map_fragment>
{
  vec2 plUv = (vPlWorldPosition.xz - uPlTerrainMin) / max(uPlTerrainSize, vec2(0.0001));
  float plDistance = texture2D(uPlRoadField, plUv).r * uPlRoadFieldRange;
  float plEdge = plDistance - uPlRoadHalfWidth;
  vec2 plGrassUv = vPlWorldPosition.xz / max(uPlUvScale, 0.001);

  // Layers are only applied when their texture asset is configured; the
  // terrain keeps its own material wherever no asset exists.
  vec3 plColor = diffuseColor.rgb;

  if (uPlHasGrass > 0.5) {
    float plVariation = texture2D(uPlGrassVariation, plUv).r;
    vec3 plGrass = texture2D(uPlGrassTex, plGrassUv).rgb * uPlGrassTint;
    plGrass *= 0.82 + 0.36 * plVariation;
    plColor = plGrass;
  }

  if (uPlHasForest > 0.5) {
    float plTreeMask = clamp(texture2D(uPlForestMask, plUv).r * 1.15, 0.0, 1.0);
    plTreeMask *= 1.0 - smoothstep(2.0, 9.0, plDistance);
    vec3 plCanopy = texture2D(uPlForestTex, plUv * 6.0).rgb * uPlForestTint;
    plColor = mix(plColor, plCanopy, plTreeMask);
  }

  if (uPlHasGravel > 0.5) {
    float plSlope = clamp(1.0 - dot(normalize(vPlWorldNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    float plRockWeight = smoothstep(uPlRockSlope, min(1.0, uPlRockSlope + 0.35), plSlope) * 0.8;
    vec3 plRock = texture2D(uPlGravelTex, vPlWorldPosition.xz / max(uPlUvScale * 0.4, 0.05)).rgb;
    plColor = mix(plColor, plRock, plRockWeight);
  }

  if (uPlHasRoad > 0.5) {
    float plRoadWeight = 1.0 - smoothstep(-0.6, 0.6, plEdge);
    if (uPlHasGravel > 0.5) {
      float plGravelWeight = (1.0 - smoothstep(0.0, max(0.05, uPlRoadShoulderWidth), plEdge)) * (1.0 - plRoadWeight);
      vec3 plGravel = texture2D(uPlGravelTex, plGrassUv * 2.0).rgb * uPlGravelTint;
      plColor = mix(plColor, plGravel, plGravelWeight * 0.85);
    }
    vec3 plRoad = texture2D(uPlRoadTex, plGrassUv * 0.5).rgb * uPlRoadTint;
    plColor = mix(plColor, plRoad, plRoadWeight);
  }

  diffuseColor.rgb = mix(diffuseColor.rgb, plColor, clamp(uPlSurfaceStrength, 0.0, 1.0));
}`

type MaterialPatchRecord = {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
  replacement: THREE.Material | THREE.Material[]
  clones: THREE.Material[]
}

export interface ProceduralLandscapeSurfacePatch {
  patchedMaterialCount: number
  skippedMaterialCount: number
  hasInjection: boolean
  restore(): void
}

function installMaterialInjection(
  material: THREE.MeshStandardMaterial,
  uniforms: ProceduralLandscapeSurfaceUniforms,
): void {
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalProgramCacheKey = material.customProgramCacheKey
  const uniformEntries = Object.entries(uniforms) as Array<[string, THREE.IUniform]>
  material.onBeforeCompile = (shader, renderer) => {
    for (const [name, uniform] of uniformEntries) {
      shader.uniforms[name] = uniform
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_HEADER)
      .replace('#include <begin_vertex>', VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_HEADER)
      .replace('#include <map_fragment>', FRAGMENT_BODY)
    if (typeof originalOnBeforeCompile === 'function') {
      originalOnBeforeCompile.call(material, shader, renderer)
    }
  }
  material.customProgramCacheKey = () => {
    const baseKey = typeof originalProgramCacheKey === 'function' ? originalProgramCacheKey.call(material) : 'pl'
    return `${baseKey}|pl-surface-v1`
  }
  material.needsUpdate = true
}

export function applyProceduralLandscapeSurfaceInjection(
  meshes: THREE.Mesh[],
  uniforms: ProceduralLandscapeSurfaceUniforms,
): ProceduralLandscapeSurfacePatch {
  const records: MaterialPatchRecord[] = []
  let patchedMaterialCount = 0
  let skippedMaterialCount = 0

  for (const mesh of meshes) {
    const original = mesh.material
    if (!original) {
      continue
    }
    const sources = Array.isArray(original) ? original : [original]
    const clones: THREE.Material[] = []
    for (const source of sources) {
      const standard = source as THREE.MeshStandardMaterial
      if (!standard.isMeshStandardMaterial) {
        skippedMaterialCount += 1
        clones.push(source)
        continue
      }
      const clone = source.clone()
      installMaterialInjection(clone as THREE.MeshStandardMaterial, uniforms)
      clones.push(clone)
      patchedMaterialCount += 1
    }
    mesh.material = Array.isArray(original) ? clones : clones[0]!
    records.push({
      mesh,
      original,
      replacement: mesh.material,
      clones: Array.isArray(original) ? clones : [clones[0]!],
    })
  }

  return {
    patchedMaterialCount,
    skippedMaterialCount,
    hasInjection: patchedMaterialCount > 0,
    restore(): void {
      for (const record of records) {
        if (record.mesh.material === record.replacement) {
          record.mesh.material = record.original
        }
        for (const clone of record.clones) {
          const source = Array.isArray(record.original) ? record.original : [record.original]
          if (!source.includes(clone)) {
            clone.dispose()
          }
        }
      }
      records.length = 0
    },
  }
}
