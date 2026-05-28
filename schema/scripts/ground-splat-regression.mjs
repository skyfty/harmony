import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const corePath = path.resolve(process.cwd(), 'core.ts')
const groundMeshPath = path.resolve(process.cwd(), 'groundMesh.ts')
const coreSource = fs.readFileSync(corePath, 'utf8')
const groundMeshSource = fs.readFileSync(groundMeshPath, 'utf8')

assert.match(
  coreSource,
  /export interface GroundSurfaceChunkLayerRef \{[\s\S]*albedoTextureSettings\?: SceneMaterialTextureSettings \| null[\s\S]*normalSource\?: string \| null[\s\S]*normalTextureSettings\?: SceneMaterialTextureSettings \| null[\s\S]*maskChannel: number[\s\S]*\}/,
  'ground surface chunk layers should preserve albedo/normal texture settings and mask channel metadata',
)

assert.match(
  coreSource,
  /export interface GroundSurfaceChunkTextureRef \{[\s\S]*baseBlendMode\?: 'shader-splat-v1' \| null[\s\S]*surfaceLayers\?: GroundSurfaceChunkLayerRef\[] \| null[\s\S]*\}/,
  'ground surface chunk refs should expose shader splat mode and surface layer descriptors',
)

assert.match(
  groundMeshSource,
  /function createGroundSplatSignature\([\s\S]*'ground-splat-v1'/,
  'ground mesh should include the ground-splat-v1 signature marker for shader-based chunk materials',
)

assert.match(
  groundMeshSource,
  /function ensureGroundSplatShaderHooks\([\s\S]*groundSplatMask0[\s\S]*groundSplatLayerMap\$\{index\}/,
  'ground mesh should install shader hooks for splat masks and layer textures',
)

assert.match(
  groundMeshSource,
  /groundSplatLayerNormalMap\$\{index\}[\s\S]*#ifdef USE_NORMALMAP_TANGENTSPACE[\s\S]*groundSplatNormalMixed/,
  'ground mesh should keep layer normal-map support behind the tangent-space normal path',
)

assert.match(
  groundMeshSource,
  /const GROUND_SPLAT_MAX_LAYERS = 4/,
  'ground splat runtime should stay limited to one RGBA mask / four layers',
)

assert.match(
  groundMeshSource,
  /export type GroundSplatRuntimeProfile = \{[\s\S]*maxLayers\?: number \| null[\s\S]*enableLayerNormalMap\?: boolean \| null[\s\S]*\}/,
  'ground splat runtime should expose a lightweight profile for mini-program tuning',
)

console.log('ground-splat regression checks passed')
