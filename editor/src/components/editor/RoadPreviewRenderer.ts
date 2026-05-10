import * as THREE from 'three'
import type { RoadDynamicMesh } from '@schema'
import { createRoadGroup, updateRoadGroup } from '@schema/roadMesh'
import {
  ROAD_TERRAIN_DEFAULT_MIN_CLEARANCE,
  ROAD_TERRAIN_DEFAULT_SAMPLING_DENSITY_FACTOR,
  ROAD_TERRAIN_DEFAULT_SMOOTHING_STRENGTH_FACTOR,
} from '@schema/components'

export type RoadPreviewSession = {
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
  width: number
}

export type RoadPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => void
  clear: (session: RoadPreviewSession | null) => void
  reset: () => void
  dispose: (session: RoadPreviewSession | null) => void
}

const ROAD_PREVIEW_SIGNATURE_PRECISION = 1000
const ROAD_PREVIEW_Y_OFFSET = 0.01
const ROAD_PREVIEW_SAMPLING_DENSITY_FACTOR = ROAD_TERRAIN_DEFAULT_SAMPLING_DENSITY_FACTOR
const ROAD_PREVIEW_HEIGHT_SAMPLING_DENSITY_FACTOR = Math.max(1, ROAD_PREVIEW_SAMPLING_DENSITY_FACTOR * 0.5)
const ROAD_PREVIEW_SMOOTHING_STRENGTH_FACTOR = ROAD_TERRAIN_DEFAULT_SMOOTHING_STRENGTH_FACTOR
const ROAD_PREVIEW_MIN_CLEARANCE = ROAD_TERRAIN_DEFAULT_MIN_CLEARANCE
const ROAD_SEGMENT_HEIGHT_SAMPLES_PER_METER = ROAD_PREVIEW_SAMPLING_DENSITY_FACTOR

export type RoadPreviewBuild = {
  center: THREE.Vector3
  worldPoints: THREE.Vector3[]
  definition: RoadDynamicMesh
}

function encodeRoadPreviewNumber(value: number): string {
  return `${Math.round(value * ROAD_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeRoadPreviewSignature(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null, width: number): string {
  if (!points.length && !previewEnd) {
    return 'empty'
  }

  const widthSignature = encodeRoadPreviewNumber(width)
  const pSignature = points
    .map((p) => [encodeRoadPreviewNumber(p.x), encodeRoadPreviewNumber(p.z)].join(','))
    .join(';')
  const endSignature = previewEnd
    ? [encodeRoadPreviewNumber(previewEnd.x), encodeRoadPreviewNumber(previewEnd.z)].join(',')
    : 'none'

  return `${widthSignature}|${pSignature}|${endSignature}`
}

function disposeRoadPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

function applyRoadPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const applyMaterial = (source: THREE.Material) => {
      const material = source as THREE.Material & {
        opacity?: number
        transparent?: boolean
        depthWrite?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        color?: { setHex?: (hex: number) => void }
        emissive?: { setHex?: (hex: number) => void }
        emissiveIntensity?: number
        toneMapped?: boolean
        needsUpdate?: boolean
      }

      const ROAD_PREVIEW_COLOR = 0x8fd3ff
      let requiresMaterialUpdate = false

      if ('opacity' in material) {
        material.opacity = 0.75
        if (material.transparent !== true) {
          material.transparent = true
          requiresMaterialUpdate = true
        }
      }

      // Make the preview clearly visible against the ground.
      material.color?.setHex?.(ROAD_PREVIEW_COLOR)
      material.emissive?.setHex?.(ROAD_PREVIEW_COLOR)
      if (typeof material.emissiveIntensity === 'number') {
        material.emissiveIntensity = 1
      }

      // Disable tone mapping so the highlight stays bright even without scene lights.
      if (typeof material.toneMapped === 'boolean') {
        if (material.toneMapped !== false) {
          material.toneMapped = false
          requiresMaterialUpdate = true
        }
      }

      // Reduce z-fighting / depth artifacts when close to the ground.
      if (typeof material.depthWrite === 'boolean') {
        if (material.depthWrite !== false) {
          material.depthWrite = false
          requiresMaterialUpdate = true
        }
      }
      if (typeof material.polygonOffset === 'boolean') {
        if (material.polygonOffset !== true) {
          material.polygonOffset = true
          requiresMaterialUpdate = true
        }
        if (material.polygonOffsetFactor !== -1) {
          material.polygonOffsetFactor = -1
          requiresMaterialUpdate = true
        }
        if (material.polygonOffsetUnits !== -1) {
          material.polygonOffsetUnits = -1
          requiresMaterialUpdate = true
        }
      }

      if (requiresMaterialUpdate && typeof material.needsUpdate === 'boolean') {
        material.needsUpdate = true
      }
    }

    const meshMaterial = mesh.material
    if (Array.isArray(meshMaterial)) {
      meshMaterial.forEach((entry) => entry && applyMaterial(entry))
    } else if (meshMaterial) {
      applyMaterial(meshMaterial)
    }

    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}

function buildPreviewWorldPoints(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null): THREE.Vector3[] {
  const combined = [...points]
  if (previewEnd && points.length) {
    combined.push(previewEnd)
  }

  const worldPoints: THREE.Vector3[] = []
  combined.forEach((point) => {
    const next = point.clone()
    const previous = worldPoints[worldPoints.length - 1]
    if (previous && previous.distanceToSquared(next) <= 1e-10) {
      return
    }
    worldPoints.push(next)
  })

  return worldPoints
}

function buildSegmentHeights(
  worldPoints: THREE.Vector3[],
  heightSampler?: ((x: number, z: number) => number) | null,
  samplesPerMeter = ROAD_SEGMENT_HEIGHT_SAMPLES_PER_METER,
): number[][] {
  if (worldPoints.length < 2) {
    return []
  }

  const segmentHeights: number[][] = []
  for (let index = 0; index < worldPoints.length - 1; index += 1) {
    const start = worldPoints[index]!
    const end = worldPoints[index + 1]!
    const length = start.distanceTo(end)
    const density = Number.isFinite(samplesPerMeter) ? Math.max(0.1, samplesPerMeter) : ROAD_SEGMENT_HEIGHT_SAMPLES_PER_METER
    const sampleCount = Math.max(2, Math.ceil(length * density) + 1)
    const heights: number[] = []

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const t = sampleCount <= 1 ? 0 : sampleIndex / (sampleCount - 1)
      const x = THREE.MathUtils.lerp(start.x, end.x, t)
      const z = THREE.MathUtils.lerp(start.z, end.z, t)
      const fallbackY = THREE.MathUtils.lerp(start.y, end.y, t)
      const sampledY = heightSampler ? heightSampler(x, z) : fallbackY
      heights.push(Number.isFinite(sampledY) ? sampledY : fallbackY)
    }

    segmentHeights.push(heights)
  }

  return segmentHeights
}

export function buildRoadPreviewBuild(
  points: THREE.Vector3[],
  previewEnd: THREE.Vector3 | null,
  width: number,
  options: {
    heightSampler?: ((x: number, z: number) => number) | null
    samplingDensityFactor?: number
  } = {},
): RoadPreviewBuild | null {
  const worldPoints = buildPreviewWorldPoints(points, previewEnd)

  if (worldPoints.length < 2) {
    return null
  }

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)

  worldPoints.forEach((p) => {
    min.x = Math.min(min.x, p.x)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.z = Math.max(max.z, p.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return null
  }

  const center = new THREE.Vector3((min.x + max.x) * 0.5, 0, (min.z + max.z) * 0.5)

  const normalizedWidth = Number.isFinite(width) ? Math.max(0.2, width) : 2
  const vertices = worldPoints.map((p) => [p.x - center.x, p.z - center.z] as [number, number])
  const segments = vertices.length >= 2
    ? Array.from({ length: vertices.length - 1 }, (_value, index) => ({ a: index, b: index + 1 }))
    : []
  const samplingDensityFactor = Number.isFinite(options.samplingDensityFactor)
    ? Math.max(0.1, options.samplingDensityFactor as number)
    : ROAD_SEGMENT_HEIGHT_SAMPLES_PER_METER
  const definition: RoadDynamicMesh = {
    type: 'Road',
    width: normalizedWidth,
    vertices,
    segments,
    segmentHeights: buildSegmentHeights(worldPoints, options.heightSampler ?? null, samplingDensityFactor),
  }

  return { center, worldPoints, definition }
}

export function createRoadPreviewRenderer(options: {
  rootGroup: THREE.Group
  /** Optional sampler in world XZ coordinates. */
  heightSampler?: ((x: number, z: number) => number) | null
}): RoadPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: RoadPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      disposeRoadPreviewGroup(preview)
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: RoadPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const build = buildRoadPreviewBuild(session.points, session.previewEnd, session.width, {
      heightSampler: options.heightSampler ?? null,
      samplingDensityFactor: ROAD_PREVIEW_HEIGHT_SAMPLING_DENSITY_FACTOR,
    })
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const nextSignature = computeRoadPreviewSignature(session.points, session.previewEnd, session.width)
    if (nextSignature === signature) {
      return
    }
    signature = nextSignature

    if (!session.previewGroup) {
      const createOpts: any = {
        samplingDensityFactor: ROAD_PREVIEW_SAMPLING_DENSITY_FACTOR,
        smoothingStrengthFactor: ROAD_PREVIEW_SMOOTHING_STRENGTH_FACTOR,
        minClearance: ROAD_PREVIEW_MIN_CLEARANCE,
      }
      const preview = createRoadGroup(build.definition, createOpts)
      applyRoadPreviewStyling(preview)
      preview.userData.isRoadPreview = true
      session.previewGroup = preview
      options.rootGroup.add(preview)
    } else {
      const updateOpts: any = {
        samplingDensityFactor: ROAD_PREVIEW_SAMPLING_DENSITY_FACTOR,
        smoothingStrengthFactor: ROAD_PREVIEW_SMOOTHING_STRENGTH_FACTOR,
        minClearance: ROAD_PREVIEW_MIN_CLEARANCE,
      }
      updateRoadGroup(session.previewGroup, build.definition, updateOpts)
      applyRoadPreviewStyling(session.previewGroup)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    session.previewGroup!.position.copy(build.center)
    session.previewGroup!.position.y += ROAD_PREVIEW_Y_OFFSET
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => {
      if (!needsSync) {
        return
      }
      flush(scene, session)
    },
    flush,
    clear,
    reset: () => {
      needsSync = false
      signature = null
    },
    dispose: (session: RoadPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
