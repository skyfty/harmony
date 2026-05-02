import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve(process.cwd(), 'src/utils/terrainDatasetRuntime.ts')
const source = fs.readFileSync(filePath, 'utf8')

assert.match(
  source,
  /const loadTile = async \(level: number, x: number, y: number\): Promise<QuantizedTerrainMeshData \| null> => \{/,
  'terrainDatasetRuntime should define a lazy tile loader instead of relying on eager region preloading',
)

assert.match(
  source,
  /resolveQuantizedTerrainRegionIdForTile\(\{ level, x, y \}, manifest\.regionLevel\)/,
  'terrainDatasetRuntime should resolve the owning region for a tile on demand',
)

assert.match(
  source,
  /if \(!tileData && !tileCache\.has\(tileKey\)\) \{\s*void loadTile\(level, parentX, parentY\)/,
  'terrainDatasetRuntime should trigger background tile loading on first sample miss',
)

assert.doesNotMatch(
  source,
  /for \(const region of manifest\.regions\) \{[\s\S]*?for \(const \[tileKey, buffer\] of Object\.entries\(pack\.entries\)\)/,
  'terrainDatasetRuntime should not eagerly preload every region pack and tile at sampler creation time',
)

console.log('terrain-dataset-runtime-lazy regression checks passed')
