import type { Context } from 'koa'
import {
  buildTerrainImageryFetchPlan,
  fetchTerrainImageryTile,
  listTerrainImageryProviders,
} from '@/services/terrainImageryService'

export async function listProviders(ctx: Context): Promise<void> {
  ctx.body = {
    providers: listTerrainImageryProviders(),
  }
}

export async function createFetchPlan(ctx: Context): Promise<void> {
  const body = ctx.request.body as Record<string, unknown> | undefined
  ctx.body = buildTerrainImageryFetchPlan({
    providerId: typeof body?.providerId === 'string' ? body.providerId : null,
    projectedCrs: typeof body?.projectedCrs === 'string' ? body.projectedCrs : null,
    sourceBounds: body?.sourceBounds as Record<string, unknown> | null | undefined,
    maxOutputSize: Number(body?.maxOutputSize),
  })
}

export async function proxyTile(ctx: Context): Promise<void> {
  const providerId = typeof ctx.params.providerId === 'string' ? ctx.params.providerId : ''
  const z = Number.parseInt(String(ctx.params.z ?? ''), 10)
  const x = Number.parseInt(String(ctx.params.x ?? ''), 10)
  const y = Number.parseInt(String(ctx.params.y ?? ''), 10)
  if (!providerId || !Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    ctx.throw(400, 'Invalid terrain imagery tile request')
  }
  const tile = await fetchTerrainImageryTile(providerId, z, x, y)
  if (tile.contentType) {
    ctx.type = tile.contentType
  }
  ctx.set('Cache-Control', tile.cacheControl ?? 'public, max-age=86400')
  ctx.body = Buffer.from(tile.buffer)
}
