import type { Context } from 'koa'
import { Types } from 'mongoose'
import { SceneProductBindingModel } from '@/models/SceneProductBinding'
import { ProductModel } from '@/models/Product'

type BindingPayload = {
  productId?: string
  enabled?: boolean
  metadata?: Record<string, unknown> | null
}

export async function listBindings(ctx: Context): Promise<void> {
  const { scenicId } = ctx.params as { scenicId: string }
  if (!Types.ObjectId.isValid(scenicId)) ctx.throw(400, 'Invalid scenic id')
  const rows = await SceneProductBindingModel.find({ sceneId: scenicId }).lean().exec()
  // enrich with product basic info
  const productIds = rows.map((r: any) => r.productId)
  const products = productIds.length ? await ProductModel.find({ _id: { $in: productIds } }).lean().exec() : []
  const prodById = new Map(products.map((p: any) => [String(p._id), p]))
  ctx.body = (rows || []).map((r: any) => ({
    id: r._id.toString(),
    productId: String(r.productId),
    enabled: Boolean(r.enabled),
    metadata: r.metadata ?? null,
    product: prodById.get(String(r.productId))
      ? {
          id: String(prodById.get(String(r.productId))._id),
          name: prodById.get(String(r.productId)).name,
        }
      : null,
  }))
}

export async function createBinding(ctx: Context): Promise<void> {
  const { scenicId } = ctx.params as { scenicId: string }
  if (!Types.ObjectId.isValid(scenicId)) ctx.throw(400, 'Invalid scenic id')
  const body = (ctx.request.body ?? {}) as BindingPayload
  if (!body.productId || !Types.ObjectId.isValid(body.productId)) ctx.throw(400, 'Invalid product id')
  // upsert unique binding per scene+product enforced by schema unique index
  const created = await SceneProductBindingModel.findOneAndUpdate(
    { sceneId: scenicId, productId: body.productId },
    { enabled: body.enabled === undefined ? true : Boolean(body.enabled), metadata: body.metadata ?? null },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  ctx.status = 201
  ctx.body = { id: created!._id.toString(), productId: String(created!.productId), enabled: Boolean(created!.enabled) }
}

export async function updateBinding(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid binding id')
  const current = await SceneProductBindingModel.findById(id).lean().exec()
  if (!current) ctx.throw(404, 'Binding not found')
  const body = (ctx.request.body ?? {}) as BindingPayload
  const updated = await SceneProductBindingModel.findByIdAndUpdate(
    id,
    {
      enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
      metadata: body.metadata === undefined ? current.metadata : body.metadata,
    },
    { new: true },
  )
    .lean()
    .exec()
  ctx.body = { id: updated!._id.toString(), productId: String(updated!.productId), enabled: Boolean(updated!.enabled) }
}

export async function deleteBinding(ctx: Context): Promise<void> {
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) ctx.throw(400, 'Invalid binding id')
  await SceneProductBindingModel.findByIdAndDelete(id).exec()
  // Return explicit body to avoid client-side JSON parse errors when receiving 204 No Content
  ctx.status = 200
  ctx.body = {}
}
