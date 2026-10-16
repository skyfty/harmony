import { describe, expect, it } from 'vitest'
import {
  eastOffsetToLongitudeDeltaDegrees,
  latLonToUtm,
  utmCentralMeridianDegrees,
  utmZoneOfLongitude,
  wgs84ParallelRadiusMeters,
} from '../wgs84Utm'

// Reference values generated with PROJ (pyproj) using EPSG:4326 -> UTM.
const REFERENCE_POINTS: Array<{
  lat: number
  lon: number
  epsg: number
  easting: number
  northing: number
}> = [
  { lat: 0, lon: 0, epsg: 32631, easting: 166021.4431, northing: 0.0 },
  { lat: 0, lon: 3, epsg: 32631, easting: 500000.0, northing: 0.0 },
  { lat: 45, lon: 3, epsg: 32631, easting: 500000.0, northing: 4982950.4002 },
  { lat: 29.6439555556, lon: 91.1158416667, epsg: 32646, easting: 317615.1942, northing: 3280817.4011 },
  { lat: -33.8688, lon: 151.2093, epsg: 32756, easting: 334368.6336, northing: 6250948.3454 },
]

describe('latLonToUtm', () => {
  for (const point of REFERENCE_POINTS) {
    it(`matches PROJ for (${point.lat}, ${point.lon}) -> EPSG:${point.epsg}`, () => {
      const result = latLonToUtm(point.lat, point.lon)
      expect(result.epsg).toBe(point.epsg)
      expect(result.easting).toBeCloseTo(point.easting, 1)
      expect(result.northing).toBeCloseTo(point.northing, 1)
    })
  }

  it('reports hemisphere for southern coordinates', () => {
    const result = latLonToUtm(-33.8688, 151.2093)
    expect(result.hemisphere).toBe('south')
    expect(result.zone).toBe(56)
  })

  it('is symmetric around the central meridian at the equator', () => {
    const west = latLonToUtm(0, 2)
    const east = latLonToUtm(0, 4)
    expect(west.easting + east.easting).toBeCloseTo(1000000, 6)
    expect(west.northing).toBeCloseTo(0, 6)
    expect(east.northing).toBeCloseTo(0, 6)
  })

  it('increases northing with latitude on the central meridian', () => {
    const lower = latLonToUtm(44, 3)
    const upper = latLonToUtm(45, 3)
    expect(upper.northing).toBeGreaterThan(lower.northing)
    expect(lower.easting).toBeCloseTo(500000, 6)
  })

  it('rejects invalid latitudes', () => {
    expect(() => latLonToUtm(91, 0)).toThrow(RangeError)
    expect(() => latLonToUtm(Number.NaN, 0)).toThrow(RangeError)
  })
})

describe('utmZoneOfLongitude', () => {
  it('derives standard zones', () => {
    expect(utmZoneOfLongitude(91.1158416667)).toBe(46)
    expect(utmZoneOfLongitude(3)).toBe(31)
    expect(utmZoneOfLongitude(-0.0001)).toBe(30)
    expect(utmZoneOfLongitude(0)).toBe(31)
  })

  it('clamps the antimeridian into 1..60', () => {
    expect(utmZoneOfLongitude(180)).toBe(60)
    expect(utmZoneOfLongitude(-180)).toBe(1)
  })
})

describe('utmCentralMeridianDegrees', () => {
  it('maps zones to central meridians', () => {
    expect(utmCentralMeridianDegrees(31)).toBe(3)
    expect(utmCentralMeridianDegrees(46)).toBe(93)
  })

  it('rejects out-of-range zones', () => {
    expect(() => utmCentralMeridianDegrees(0)).toThrow(RangeError)
    expect(() => utmCentralMeridianDegrees(61)).toThrow(RangeError)
  })
})

describe('eastOffsetToLongitudeDeltaDegrees', () => {
  it('approximates the longitude delta for a known parallel radius', () => {
    const radius = wgs84ParallelRadiusMeters(29.64)
    const delta = eastOffsetToLongitudeDeltaDegrees(radius, 29.64)
    expect(delta).toBeCloseTo(180 / Math.PI, 6)
  })

  it('rejects degenerate parallels near the poles', () => {
    expect(() => eastOffsetToLongitudeDeltaDegrees(10, 90)).toThrow(RangeError)
  })
})
