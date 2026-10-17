/** WGS84 -> UTM conversion (Snyder series, sub-meter for DEM purposes). */
export interface UtmCoordinate {
  easting: number
  northing: number
  zone: number
  hemisphere: 'north' | 'south'
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

function normalizeLongitude(lonDeg: number): number {
  const value = ((lonDeg + 180) % 360 + 360) % 360 - 180
  if (value === -180 && lonDeg > 0) {
    return 180
  }
  return value
}

export function utmZoneOfLongitude(lonDeg: number): number {
  const lon = normalizeLongitude(lonDeg)
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))
}

export function utmCentralMeridianDegrees(zone: number): number {
  return (zone - 1) * 6 - 180 + 3
}

function meridianArcLength(phi: number): number {
  const e2 = WGS84_ECCENTRICITY_SQUARED
  const e4 = e2 * e2
  const e6 = e4 * e2
  const a0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256
  const a2 = (3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024
  const a4 = (15 * e4) / 256 + (45 * e6) / 1024
  const a6 = (35 * e6) / 3072
  return WGS84_SEMI_MAJOR_AXIS
    * (a0 * phi - a2 * Math.sin(2 * phi) + a4 * Math.sin(4 * phi) - a6 * Math.sin(6 * phi))
}

export function latLonToUtm(latDeg: number, lonDeg: number, zone?: number): UtmCoordinate {
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
    A + ((1 - T + C) * A3) / 6
      + ((5 - 18 * T + T * T + 72 * C - 58 * e2p) * A5) / 120
  )
  const northingOffset = UTM_SCALE_FACTOR * (
    meridianArcLength(phi) + primeVerticalRadius * tanPhi * (
      A2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A4) / 24
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
