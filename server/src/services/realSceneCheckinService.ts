import { Types } from 'mongoose'
import { SceneSpotModel } from '@/models/SceneSpot'
import { SceneSpotInteractionModel } from '@/models/SceneSpotInteraction'

export interface RealSceneLocation {
  latitude: number
  longitude: number
}

export interface RealSceneCheckinMatch {
  sceneSpotId: string
  sceneId: string
  title: string
  distanceMeters: number
}

const DEFAULT_MATCH_RADIUS_METERS = 100

function parseFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseRealSceneLocation(input: unknown): RealSceneLocation | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as Record<string, unknown>
  const latitude = parseFiniteNumber(candidate.latitude ?? candidate.lat)
  const longitude = parseFiniteNumber(candidate.longitude ?? candidate.lng)
  if (latitude === null || longitude === null) {
    return null
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null
  }

  return { latitude, longitude }
}

export async function findNearestSceneSpotByLocation(
  location: RealSceneLocation,
  maxDistanceMeters = DEFAULT_MATCH_RADIUS_METERS,
): Promise<RealSceneCheckinMatch | null> {
  const radius = Number.isFinite(maxDistanceMeters) && maxDistanceMeters > 0 ? maxDistanceMeters : DEFAULT_MATCH_RADIUS_METERS
  const rows = await SceneSpotModel.aggregate<{
    _id: Types.ObjectId
    sceneId: Types.ObjectId
    title: string
    distanceMeters: number
  }>([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude],
        },
        key: 'location',
        distanceField: 'distanceMeters',
        spherical: true,
        maxDistance: radius,
        query: {
          location: { $exists: true },
        },
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 1,
        sceneId: 1,
        title: 1,
        distanceMeters: 1,
      },
    },
  ]).exec()

  const first = rows[0]
  if (!first) {
    return null
  }

  return {
    sceneSpotId: first._id.toString(),
    sceneId: first.sceneId.toString(),
    title: String(first.title || ''),
    distanceMeters: Number(first.distanceMeters || 0),
  }
}

export async function recordRealSceneCheckinByLocation(input: {
  userId?: string
  location: RealSceneLocation
  maxDistanceMeters?: number
}): Promise<RealSceneCheckinMatch | null> {
  if (!input.userId || !Types.ObjectId.isValid(input.userId)) {
    return null
  }

  const match = await findNearestSceneSpotByLocation(input.location, input.maxDistanceMeters)
  if (!match) {
    return null
  }

  const now = new Date()
  await SceneSpotInteractionModel.findOneAndUpdate(
    {
      userId: new Types.ObjectId(input.userId),
      sceneSpotId: new Types.ObjectId(match.sceneSpotId),
    },
    {
      $set: {
        realSceneCheckedInAt: now,
      },
      $setOnInsert: {
        favorited: false,
        rating: null,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).exec()

  return match
}
