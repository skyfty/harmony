import { describe, expect, it } from 'vitest'
import {
  decodeTerrainDemRuntimeOrthoFile,
  encodeTerrainDemRuntimeOrthoFile,
  terrainDemRuntimeOrthoCoverage,
  terrainDemRuntimeOrthoToRgba,
} from '@schema/terrainDemRuntimeOrtho'
import {
  createDefaultProceduralLandscapeProps,
  resolveProceduralLandscapeBaseMapBlend,
  resolveProceduralLandscapeBaseMapMode,
  shouldLoadProceduralLandscapeOrtho,
} from '@schema/proceduralLandscape/config'

describe('DEM runtime orthophoto format', () => {
  it('round-trips width, height, RGB rows and opaque RGBA expansion', () => {
    const rgb = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      12, 34, 56,
    ])
    const encoded = encodeTerrainDemRuntimeOrthoFile({
      width: 2,
      height: 2,
      rgb,
    })
    const decoded = decodeTerrainDemRuntimeOrthoFile(encoded)

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(Array.from(decoded.rgb)).toEqual(Array.from(rgb))
    expect(Array.from(terrainDemRuntimeOrthoToRgba(decoded))).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      12, 34, 56, 255,
    ])
  })

  it('rejects mismatched dimensions and truncated payloads', () => {
    expect(() => encodeTerrainDemRuntimeOrthoFile({
      width: 2,
      height: 2,
      rgb: new Uint8Array([1, 2, 3]),
    })).toThrow(/byte count/)

    const encoded = encodeTerrainDemRuntimeOrthoFile({
      width: 1,
      height: 1,
      rgb: new Uint8Array([1, 2, 3]),
    })
    expect(() => decodeTerrainDemRuntimeOrthoFile(encoded.slice(0, 8))).toThrow()
  })

  it('reports missing black pixels as incomplete aerial coverage', () => {
    expect(terrainDemRuntimeOrthoCoverage({
      width: 2,
      height: 2,
      rgb: new Uint8Array([
        10, 20, 30,
        0, 0, 0,
        0, 0, 0,
        40, 50, 60,
      ]),
    })).toBe(0.5)
  })

  it('loads original DEM orthophoto only for the aerial surface mode', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.dem.assetId = 'dem-asset'
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(false)

    props.surface.baseMapMode = 'blend'
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(false)

    props.surface.baseMapMode = 'aerial'
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(true)

    props.surface.enabled = false
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(false)
  })

  it('keeps DEM aerial selected and normalizes legacy blend to procedural', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.dem.assetId = 'dem-asset'
    props.surface.baseMapMode = 'aerial'
    expect(resolveProceduralLandscapeBaseMapMode(props)).toBe('aerial')

    props.surface.baseMapMode = 'blend'
    expect(resolveProceduralLandscapeBaseMapMode(props)).toBe('replace')

    props.dem.assetId = null
    expect(resolveProceduralLandscapeBaseMapMode(props)).toBe('blend')
  })

  it('maps base-map modes to their effective shader weights', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.surface.baseMapBlend = 0.35

    expect(resolveProceduralLandscapeBaseMapBlend(props)).toBe(0)

    props.surface.baseMapMode = 'aerial'
    expect(resolveProceduralLandscapeBaseMapBlend(props)).toBe(1)

    props.surface.baseMapMode = 'blend'
    expect(resolveProceduralLandscapeBaseMapBlend(props)).toBe(0.35)

    props.dem.assetId = 'dem-asset'
    expect(resolveProceduralLandscapeBaseMapBlend(props)).toBe(0)
  })

})
