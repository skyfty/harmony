import type { Context } from 'koa'
import {
  createBusinessOrder,
  getBusinessOrderBootstrap,
  getLatestBusinessOrderForUser,
} from '@/services/businessOrderService'

export async function getBusinessOrderBootstrapHandler(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  ctx.body = await getBusinessOrderBootstrap(userId)
}

export async function createBusinessOrderHandler(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  try {
    const order = await createBusinessOrder({
      userId,
      scenicName: (ctx.request.body as Record<string, unknown>)?.scenicName as string,
      addressText: (ctx.request.body as Record<string, unknown>)?.addressText as string,
      location: (ctx.request.body as Record<string, unknown>)?.location as { lat?: number; lng?: number } | null,
      contactPhone: (ctx.request.body as Record<string, unknown>)?.contactPhone as string,
      scenicArea: (ctx.request.body as Record<string, unknown>)?.scenicArea as number | null,
      sceneSpotCategoryId: (ctx.request.body as Record<string, unknown>)?.sceneSpotCategoryId as string | null,
      specialLandscapeTags: (ctx.request.body as Record<string, unknown>)?.specialLandscapeTags as string[],
    })
    ctx.status = 201
    ctx.body = order
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Create business order failed')
  }
}

export async function getCurrentBusinessOrderHandler(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  ctx.body = {
    order: await getLatestBusinessOrderForUser(userId),
  }
}