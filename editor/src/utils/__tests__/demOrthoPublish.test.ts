import { describe, expect, it } from 'vitest'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import { stripInactiveDemOrthoReferences } from '@/utils/demOrthoPublish'

function makeDocument(options: {
  enabled: boolean
  baseMapMode: 'replace' | 'blend'
}) {
  return {
    nodes: [
      {
        id: 'terrain',
        name: 'Terrain',
        nodeType: 'Group',
        components: {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            props: {
              dem: {
                assetId: 'dem-asset',
                runtimeOrthoUrl: 'https://example.test/runtime/ortho-rgb.bin',
                runtimeOrthoBytes: 1234,
              },
              surface: {
                enabled: options.enabled,
                baseMapMode: options.baseMapMode,
              },
            },
          },
        },
      },
    ],
    assetCatalog: {},
  } as any
}

describe('DEM orthophoto publish filtering', () => {
  it('removes runtime orthophoto references for official-cover scenes', () => {
    const document = makeDocument({ enabled: true, baseMapMode: 'replace' })
    stripInactiveDemOrthoReferences(document)
    const dem = document.nodes[0].components[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE].props.dem
    expect(dem.runtimeOrthoUrl).toBeNull()
    expect(dem.runtimeOrthoBytes).toBeNull()
  })

  it('removes runtime orthophoto references when the surface is disabled', () => {
    const document = makeDocument({ enabled: false, baseMapMode: 'blend' })
    stripInactiveDemOrthoReferences(document)
    const dem = document.nodes[0].components[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE].props.dem
    expect(dem.runtimeOrthoUrl).toBeNull()
  })

  it('keeps the URL for an active blend mode without embedding a file', () => {
    const document = makeDocument({ enabled: true, baseMapMode: 'blend' })
    stripInactiveDemOrthoReferences(document)
    const dem = document.nodes[0].components[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE].props.dem
    expect(dem.runtimeOrthoUrl).toBe('https://example.test/runtime/ortho-rgb.bin')
    expect(dem.runtimeOrthoBytes).toBe(1234)
    expect(document.files).toBeUndefined()
  })
})
