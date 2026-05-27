import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const corePath = path.resolve(process.cwd(), 'core.ts')
const groundMeshPath = path.resolve(process.cwd(), 'groundMesh.ts')
const coreSource = fs.readFileSync(corePath, 'utf8')
const groundMeshSource = fs.readFileSync(groundMeshPath, 'utf8')

assert.match(
  coreSource,
  /export interface GroundSurfaceChunkLayerRef \{[\s\S]*albedoTextureSettings\?: SceneMaterialTextureSettings \| null[\s\S]*maskChannel: number[\s\S]*\}/,
  'ground surface chunk layers should preserve full albedo texture settings and mask channel metadata',
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

console.log('ground-splat regression checks passed')
