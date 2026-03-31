import type { Context } from 'koa'
import { listHotSpots } from '@/services/hotSpotService'
import { listFeaturedSpots } from '@/services/featuredSpotService'

export async function listHotSpotsPublic(ctx: Context): Promise<void> {
  ctx.body = await listHotSpots()
}

export async function listFeaturedSpotsPublic(ctx: Context): Promise<void> {
  ctx.body = await listFeaturedSpots()
}
