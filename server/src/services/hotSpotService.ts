import { Types } from 'mongoose'
import { HotSpotModel } from '@/models/HotSpot'
import { SceneSpotModel } from '@/models/SceneSpot'

export interface HotSpotView {
  id: string
  sceneSpotId: string
  sceneSpotTitle?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

function toView(row: any): HotSpotView {
  return {
    id: String(row._id),
    sceneSpotId: String(row.sceneSpotId),
    sceneSpotTitle: row.sceneSpot?.title ?? null,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

export async function listHotSpots(): Promise<HotSpotView[]> {
  const rows = await HotSpotModel.find({}).sort({ order: 1, createdAt: -1 }).populate('sceneSpotId', 'title').lean().exec()
  return (rows as any[]).map((r) => toView({ ...r, sceneSpot: r.sceneSpotId }))
}

export async function createHotSpot(payload: { sceneSpotId?: unknown; order?: unknown }): Promise<HotSpotView> {
  const rawId = typeof payload.sceneSpotId === 'string' ? payload.sceneSpotId.trim() : undefined
  if (!rawId || !Types.ObjectId.isValid(rawId)) throw new Error('Invalid sceneSpotId')
  const sceneSpot = await SceneSpotModel.findById(rawId).lean().exec()
  if (!sceneSpot) throw new Error('SceneSpot not found')
  const created = await HotSpotModel.create({ sceneSpotId: new Types.ObjectId(rawId), order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0 })
  return toView({ ...created.toObject(), sceneSpot })
}

export async function updateHotSpotOrder(hotSpotId: string, order: unknown): Promise<HotSpotView | null> {
  if (!Types.ObjectId.isValid(hotSpotId)) throw new Error('Invalid id')
  const updated = await HotSpotModel.findByIdAndUpdate(hotSpotId, { order: Number.isFinite(Number(order)) ? Number(order) : 0 }, { new: true }).lean().exec()
  if (!updated) return null
  const sceneSpot = await SceneSpotModel.findById(updated.sceneSpotId).lean().exec()
  return toView({ ...updated, sceneSpot })
}

export async function deleteHotSpot(hotSpotId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(hotSpotId)) throw new Error('Invalid id')
  const current = await HotSpotModel.findById(hotSpotId).lean().exec()
  if (!current) return false
  await HotSpotModel.findByIdAndDelete(hotSpotId).exec()
  return true
}
