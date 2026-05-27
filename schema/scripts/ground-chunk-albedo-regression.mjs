import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'groundMesh.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /new THREE\.MeshStandardMaterial\(\{\s*\/\/ Baked chunk albedo already contains the resolved ground \+ landform base color\.[\s\S]*color: '#ffffff',/,
  'ground chunk textured material should use a white base color so baked albedo is not multiplied twice',
)

assert.match(
  source,
  /new THREE\.MeshStandardMaterial\(\{[\s\S]*roughness: typeof baseStandard\.roughness === 'number' \? baseStandard\.roughness : 0\.85,[\s\S]*metalness: typeof baseStandard\.metalness === 'number' \? baseStandard\.metalness : 0\.05,/,
  'ground chunk textured material should continue inheriting roughness and metalness defaults from the base material',
)

assert.match(
  source,
  /if \(typeof baseStandard\.envMapIntensity === 'number'\) \{\s*nextMaterial\.envMapIntensity = baseStandard\.envMapIntensity\s*\}/,
  'ground chunk textured material should continue inheriting envMapIntensity from the base material',
)

assert.match(
  source,
  /const signature = \[\s*'ground-chunk-albedo-v2',/,
  'ground chunk textured material signature should include the v2 cache-busting marker',
)

console.log('ground-chunk-albedo regression checks passed')
