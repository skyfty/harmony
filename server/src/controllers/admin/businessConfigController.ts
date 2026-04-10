import type { Context } from 'koa'
import { getBusinessConfig, updateBusinessConfig } from '@/services/businessConfigService'

export async function getBusinessConfigHandler(ctx: Context): Promise<void> {
  ctx.body = await getBusinessConfig()
}

export async function updateBusinessConfigHandler(ctx: Context): Promise<void> {
  try {
    const contactPhone = (ctx.request.body as Record<string, unknown>)?.contactPhone
    ctx.body = await updateBusinessConfig(typeof contactPhone === 'string' ? contactPhone : '')
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Update business config failed')
  }
}