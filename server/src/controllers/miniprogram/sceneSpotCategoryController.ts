import type { Context } from 'koa'
import { listSceneSpotCategories } from '@/services/sceneSpotCategoryService'

export async function listCategories(ctx: Context): Promise<void> {
  ctx.body = await listSceneSpotCategories()
}
