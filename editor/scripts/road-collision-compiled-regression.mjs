import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/roadCollisionCompiledExport.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.doesNotMatch(
  source,
  /__roadCollisionCompiledRigidbody/,
  'roadCollisionCompiledExport should not fabricate a synthetic rigidbody for road nodes',
)

assert.match(
  source,
  /function normalizeRigidbodyComponent\([\s\S]*?if \(existing && existing\.enabled !== false\) \{\s*return existing\s*\}\s*return null\s*\}/,
  'roadCollisionCompiledExport should only accept an explicitly authored rigidbody component',
)

assert.match(
  source,
  /if \(!rigidbodyComponent \|\| rigidbodyComponent\.props\.bodyType !== 'STATIC'\) \{\s*return null\s*\}/,
  'roadCollisionCompiledExport should require an explicit static rigidbody before building compiled road collision data',
)

console.log('road-collision-compiled regression checks passed')
