import { describe, expect, it } from 'vitest'
import type { ProjectAsset } from '@/types/project-asset'
import { getAssetTypePresentation } from '@/utils/assetTypePresentation'

function createFileAsset(metadata?: ProjectAsset['metadata']): ProjectAsset {
  return {
    id: 'terrain-dem',
    name: '青龙山地形',
    type: 'file',
    downloadUrl: 'https://assets.example.com/terrain-packs/terrain-dem/terrain-dem.zip',
    previewColor: '#546E7A',
    gleaned: false,
    metadata,
  }
}

describe('getAssetTypePresentation', () => {
  it('presents a DEM terrain pack as DEM Terrain instead of a generic zip', () => {
    const metadata = {
      terrainPack: {
        version: 1,
        kind: 'dem',
        packKey: 'terrain-packs/terrain-dem',
        sourceZipName: 'terrain-dem-29.64396-91.11584.zip',
        runtimeGridUrl: 'https://assets.example.com/terrain-packs/terrain-dem/runtime/dem-grid.bin',
      },
    }

    expect(getAssetTypePresentation(createFileAsset(metadata))).toMatchObject({
      label: 'DEM Terrain',
      shortLabel: 'DEM',
      icon: 'mdi-terrain',
    })
  })

  it('keeps a plain zip file as a generic file asset', () => {
    expect(getAssetTypePresentation(createFileAsset())).toMatchObject({
      label: 'File',
      shortLabel: 'FILE',
    })
  })
})
