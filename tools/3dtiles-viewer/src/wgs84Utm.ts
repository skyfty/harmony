/**
 * WGS84 geodetic (latitude / longitude) to UTM conversion using the standard
 * Transverse Mercator series expansion (Snyder, "Map Projections - A Working
 * Manual"). The accuracy is sub-meter inside a UTM zone, which is far below
 * the resolution of the terrain exports this tool produces.
 *
 * The implementation deliberately avoids external projection dependencies so
 * the viewer bundle stays small and the conversion is unit-testable.
 */

export interface UtmCoordinate {
  easting: number
  northing: number
  /** UTM zone number 1..60. */
  zone: number
  hemisphere: 'north' | 'south'
  /** EPSG code of the resulting projected CRS (326xx north / 327xx south). */
  epsg: number
}

const WGS84_SEMI_MAJOR_AXIS = 6378137
const WGS84_FLATTENING = 1 / 298.257223563
const UTM_SCALE_FACTOR = 0.9996
const UTM_FALSE_EASTING = 500000
const UTM_FALSE_NORTHING_SOUTH = 10000000

const WGS84_ECCENTRICITY_SQUARED = 2 * WGS84_FLATTENING - WGS84_FLATTENING * WGS84_FLATTENING
const WGS84_SECOND_ECCENTRICITY_SQUARED =
  WGS84_ECCENTRICITY_SQUARED / (1 - WGS84_ECCENTRICITY_SQUARED)

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

function normalizeLongitude(lonDeg: number): number {
  if (!Number.isFinite(lonDeg)) {
    throw new RangeError(`Longitude must be finite, received ${lonDeg}`)
  }
  const value = ((lonDeg + 180) % 360 + 360) % 360 - 180
  // -180 and +180 are the same meridian but belong to UTM zones 1 and 60
  // respectively; keep the caller's sign so both edge cases resolve.
  if (value === -180 && lonDeg > 0) {
    return 180
  }
  return value
}

/** UTM zone number (1..60) that contains the given longitude. */
export function utmZoneOfLongitude(lonDeg: number): number {
  const lon = normalizeLongitude(lonDeg)
  const zone = Math.floor((lon + 180) / 6) + 1
  return Math.min(60, Math.max(1, zone))
}

/** Longitude of the central meridian of a UTM zone, in degrees. */
export function utmCentralMeridianDegrees(zone: number): number {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new RangeError(`UTM zone must be an integer in 1..60, received ${zone}`)
  }
  return (zone - 1) * 6 - 180 + 3
}

/**
 * Radius of the WGS84 parallel (circle of latitude) at the given latitude,
 * i.e. the local east-west meters per radian of longitude.
 */
export function wgs84ParallelRadiusMeters(latDeg: number): number {
  const phi = latDeg * DEG_TO_RAD
  const sinPhi = Math.sin(phi)
  const primeVerticalRadius =
    WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinPhi * sinPhi)
  return primeVerticalRadius * Math.cos(phi)
}

function meridianArcLength(phi: number): number {
  const e2 = WGS84_ECCENTRICITY_SQUARED
  const e4 = e2 * e2
  const e6 = e4 * e2
  const a0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256
  const a2 = (3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024
  const a4 = (15 * e4) / 256 + (45 * e6) / 1024
  const a6 = (35 * e6) / 3072
  return (
    WGS84_SEMI_MAJOR_AXIS
    * (a0 * phi - a2 * Math.sin(2 * phi) + a4 * Math.sin(4 * phi) - a6 * Math.sin(6 * phi))
  )
}

/**
 * Projects a WGS84 geodetic coordinate to UTM. The zone is derived from the
 * longitude; pass `zone` explicitly to force a neighbouring zone (not used by
 * the terrain exporter, but convenient for tests and edge cases).
 */
export function latLonToUtm(latDeg: number, lonDeg: number, zone?: number): UtmCoordinate {
  if (!Number.isFinite(latDeg) || latDeg < -90 || latDeg > 90) {
    throw new RangeError(`Latitude must be within -90..90, received ${latDeg}`)
  }
  const effectiveZone = zone ?? utmZoneOfLongitude(lonDeg)
  const hemisphere: UtmCoordinate['hemisphere'] = latDeg < 0 ? 'south' : 'north'

  const phi = latDeg * DEG_TO_RAD
  const lambda = normalizeLongitude(lonDeg) * DEG_TO_RAD
  const lambda0 = utmCentralMeridianDegrees(effectiveZone) * DEG_TO_RAD

  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const tanPhi = Math.tan(phi)
  const e2 = WGS84_ECCENTRICITY_SQUARED
  const e2p = WGS84_SECOND_ECCENTRICITY_SQUARED

  const primeVerticalRadius = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - e2 * sinPhi * sinPhi)
  const T = tanPhi * tanPhi
  const C = e2p * cosPhi * cosPhi
  const A = (lambda - lambda0) * cosPhi

  const A2 = A * A
  const A3 = A2 * A
  const A4 = A2 * A2
  const A5 = A4 * A
  const A6 = A3 * A3

  const easting = UTM_FALSE_EASTING + UTM_SCALE_FACTOR * primeVerticalRadius * (
    A
    + ((1 - T + C) * A3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * e2p) * A5) / 120
  )

  const northingOffset = UTM_SCALE_FACTOR * (
    meridianArcLength(phi)
    + primeVerticalRadius * tanPhi * (
      A2 / 2
      + ((5 - T + 9 * C + 4 * C * C) * A4) / 24
      + ((61 - 58 * T + T * T + 600 * C - 330 * e2p) * A6) / 720
    )
  )
  const northing = (hemisphere === 'south' ? UTM_FALSE_NORTHING_SOUTH : 0) + northingOffset

  return {
    easting,
    northing,
    zone: effectiveZone,
    hemisphere,
    epsg: (hemisphere === 'south' ? 32700 : 32600) + effectiveZone,
  }
}

/** Converts local ENU offsets (meters) into an approximate longitude delta. */
export function eastOffsetToLongitudeDeltaDegrees(eastOffsetMeters: number, latDeg: number): number {
  const radius = wgs84ParallelRadiusMeters(latDeg)
  if (!(radius > 1)) {
    throw new RangeError('Parallel radius is degenerate near the poles; UTM export is not supported there.')
  }
  return (eastOffsetMeters / radius) * RAD_TO_DEG
}
