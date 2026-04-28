import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/groundHeightSidecar.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /function alignToFloat64Boundary\(byteLength: number\): number \{[\s\S]*Math\.ceil\(byteLength \/ FLOAT64_ALIGNMENT_BYTES\) \* FLOAT64_ALIGNMENT_BYTES/,
  'groundHeightSidecar should align float64 payloads to 8-byte boundaries',
)
assert.match(
  source,
  /function resolveGroundHeightSidecarLayoutFromHeader\(headerByteLength: number, metadataByteLength: number, vertexCount: number\): GroundHeightSidecarLayout \{[\s\S]*const manualOffset = alignToFloat64Boundary\(headerByteLength \+ metadataByteLength\)/,
  'groundHeightSidecar should derive aligned offsets from the actual header size',
)
assert.match(
  source,
  /const manual = new Float64Array\(buffer, layout\.manualOffset, vertexCount\)[\s\S]*const planning = new Float64Array\(buffer, layout\.planningOffset, vertexCount\)/,
  'groundHeightSidecar should construct float64 views from aligned offsets only',
)
assert.match(
  source,
  /if \(headerByteLength \+ metadataByteLength > buffer\.byteLength\) \{[\s\S]*throw new Error\(`Invalid \$\{GROUND_HEIGHTMAP_SIDECAR_FILENAME\} header`\)[\s\S]*const layout = resolveGroundHeightSidecarLayoutFromHeader\(headerByteLength, metadataByteLength, vertexCount\)[\s\S]*const expectedByteLength = layout\.totalByteLength/,
  'groundHeightSidecar should validate metadata bounds and expected size using the aligned layout total byte length',
)

console.log('ground-height-sidecar alignment regression checks passed')