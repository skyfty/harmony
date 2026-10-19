import { describe, expect, it } from 'vitest'
import {
  decodeTerrainDemRuntimeOrthoFile,
  encodeTerrainDemRuntimeOrthoFile,
  terrainDemRuntimeOrthoToRgba,
} from '@schema/terrainDemRuntimeOrtho'
import {
  createDefaultProceduralLandscapeProps,
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

  it('loads only when blend mode and the surface are enabled', () => {
    const props = createDefaultProceduralLandscapeProps({ id: 'terrain' })
    props.dem.runtimeOrthoUrl = 'https://example.test/runtime/ortho-rgb.bin'
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(false)

    props.surface.baseMapMode = 'blend'
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(true)

    props.surface.enabled = false
    expect(shouldLoadProceduralLandscapeOrtho(props)).toBe(false)
  })
})
