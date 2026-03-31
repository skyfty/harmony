import { Types } from 'mongoose'
import { FeaturedSpotModel } from '@/models/FeaturedSpot'
import { SceneSpotModel } from '@/models/SceneSpot'

export interface FeaturedSpotView {
  id: string
  sceneSpotId: string
  sceneSpotTitle?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

function toView(row: any): FeaturedSpotView {
  return {
    id: String(row._id),
    sceneSpotId: String(row.sceneSpotId),
    sceneSpotTitle: row.sceneSpot?.title ?? null,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

export async function listFeaturedSpots(): Promise<FeaturedSpotView[]> {
  const rows = await FeaturedSpotModel.find({}).sort({ order: 1, createdAt: -1 }).populate('sceneSpotId', 'title').lean().exec()
  return (rows as any[]).map((r) => toView({ ...r, sceneSpot: r.sceneSpotId }))
}

export async function createFeaturedSpot(payload: { sceneSpotId?: unknown; order?: unknown }): Promise<FeaturedSpotView> {
  const rawId = typeof payload.sceneSpotId === 'string' ? payload.sceneSpotId.trim() : undefined
  if (!rawId || !Types.ObjectId.isValid(rawId)) throw new Error('Invalid sceneSpotId')
  // prevent duplicate entries
  const exists = await FeaturedSpotModel.exists({ sceneSpotId: rawId })
  if (exists) throw new Error('SceneSpot already exists in featured spots')

  const sceneSpot = await SceneSpotModel.findById(rawId).lean().exec()
  if (!sceneSpot) throw new Error('SceneSpot not found')
  const created = await FeaturedSpotModel.create({ sceneSpotId: new Types.ObjectId(rawId), order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0 })
  return toView({ ...created.toObject(), sceneSpot })
}

export async function updateFeaturedSpotOrder(featuredSpotId: string, order: unknown): Promise<FeaturedSpotView | null> {
  if (!Types.ObjectId.isValid(featuredSpotId)) throw new Error('Invalid id')
  const updated = await FeaturedSpotModel.findByIdAndUpdate(featuredSpotId, { order: Number.isFinite(Number(order)) ? Number(order) : 0 }, { new: true }).lean().exec()
  if (!updated) return null
  const sceneSpot = await SceneSpotModel.findById(updated.sceneSpotId).lean().exec()
  return toView({ ...updated, sceneSpot })
}

export async function deleteFeaturedSpot(featuredSpotId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(featuredSpotId)) throw new Error('Invalid id')
  const current = await FeaturedSpotModel.findById(featuredSpotId).lean().exec()
  if (!current) return false
  await FeaturedSpotModel.findByIdAndDelete(featuredSpotId).exec()
  return true
}
