import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MiniAddressModel } from '@/models/MiniAddress'
import { ensureUserId } from './utils'

interface AddressLean {
  _id: Types.ObjectId
  userId: Types.ObjectId
  receiverName: string
  phone: string
  region: string
  detail: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

interface AddressPayload {
  receiverName?: string
  phone?: string
  region?: string
  detail?: string
  isDefault?: boolean
}

function toAddressResponse(address: AddressLean) {
  return {
    id: address._id.toString(),
    receiverName: address.receiverName,
    phone: address.phone,
    region: address.region,
    detail: address.detail,
    isDefault: address.isDefault,
    updatedAt: address.updatedAt.toISOString(),
  }
}

function normalizeAddressPayload(payload: AddressPayload, partial = false): Required<AddressPayload> {
  const receiverName = typeof payload.receiverName === 'string' ? payload.receiverName.trim() : ''
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : ''
  const region = typeof payload.region === 'string' ? payload.region.trim() : ''
  const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
  const isDefault = Boolean(payload.isDefault)

  if (!partial) {
    if (!receiverName || !phone || !region || !detail) {
      throw new Error('Invalid payload')
    }
  }

  return {
    receiverName,
    phone,
    region,
    detail,
    isDefault,
  }
}

export async function listAddresses(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const list = (await MiniAddressModel.find({ userId })
    .sort({ isDefault: -1, updatedAt: -1 })
    .lean()
    .exec()) as AddressLean[]

  const addresses = list.map(toAddressResponse)
  ctx.body = {
    total: addresses.length,
    addresses,
  }
}

export async function getAddress(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid address id')
  }

  const address = (await MiniAddressModel.findOne({ _id: id, userId }).lean().exec()) as AddressLean | null
  if (!address) {
    ctx.throw(404, 'Address not found')
    return
  }

  ctx.body = toAddressResponse(address)
}

export async function createAddress(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const payload = ctx.request.body as AddressPayload

  let normalized: Required<AddressPayload>
  try {
    normalized = normalizeAddressPayload(payload)
  } catch {
    ctx.throw(400, 'Invalid address payload')
    return
  }

  if (normalized.isDefault) {
    await MiniAddressModel.updateMany({ userId }, { $set: { isDefault: false } }).exec()
  }

  const created = await MiniAddressModel.create({
    userId,
    receiverName: normalized.receiverName,
    phone: normalized.phone,
    region: normalized.region,
    detail: normalized.detail,
    isDefault: normalized.isDefault,
  })

  const address = (await MiniAddressModel.findById(created._id).lean().exec()) as AddressLean | null
  ctx.status = 201
  ctx.body = address ? toAddressResponse(address) : null
}

export async function updateAddress(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid address id')
  }

  const payload = ctx.request.body as AddressPayload
  const normalized = normalizeAddressPayload(payload, true)

  const updatePayload: Record<string, unknown> = {}
  if (normalized.receiverName) updatePayload.receiverName = normalized.receiverName
  if (normalized.phone) updatePayload.phone = normalized.phone
  if (normalized.region) updatePayload.region = normalized.region
  if (normalized.detail) updatePayload.detail = normalized.detail
  if (typeof payload.isDefault === 'boolean') {
    updatePayload.isDefault = normalized.isDefault
  }

  if (!Object.keys(updatePayload).length) {
    ctx.throw(400, 'No fields to update')
    return
  }

  if (updatePayload.isDefault === true) {
    await MiniAddressModel.updateMany({ userId, _id: { $ne: id } }, { $set: { isDefault: false } }).exec()
  }

  const address = (await MiniAddressModel.findOneAndUpdate({ _id: id, userId }, updatePayload, {
    new: true,
  })
    .lean()
    .exec()) as AddressLean | null

  if (!address) {
    ctx.throw(404, 'Address not found')
    return
  }

  ctx.body = toAddressResponse(address)
}

export async function deleteAddress(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid address id')
  }

  const removed = await MiniAddressModel.findOneAndDelete({ _id: id, userId }).lean().exec()
  if (!removed) {
    ctx.throw(404, 'Address not found')
    return
  }

  ctx.body = { success: true }
}
