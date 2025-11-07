import type { Context } from 'koa'
import { Types } from 'mongoose'
import { UploadRecordModel } from '@/models/UploadRecord'
import { WorkModel } from '@/models/Work'
import { ensureUserId } from './utils'
import type { WorkLean } from './workHelpers'

interface UploadRecordLean {
  _id: Types.ObjectId
  userId: Types.ObjectId
  workId: Types.ObjectId
  fileName: string
  fileUrl: string
  mediaType: string
  fileSize?: number
  createdAt: Date
}

interface UploadRecordResponse {
  id: string
  workId: string
  fileName: string
  fileUrl: string
  mediaType: string
  fileSize?: number
  uploadedAt: string
  work?: {
    id: string
    title: string
    thumbnailUrl?: string
  }
}

export async function listUploadRecords(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const records = (await UploadRecordModel.find({ userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as UploadRecordLean[]
  const workIds = Array.from(new Set(records.map((record) => record.workId.toString())))
  let workMap = new Map<string, WorkLean>()
  if (workIds.length) {
    const works = (await WorkModel.find({ _id: { $in: workIds } })
      .lean()
      .exec()) as WorkLean[]
    workMap = new Map(works.map((work) => [work._id.toString(), work]))
  }
  const data: UploadRecordResponse[] = records.map((record) => {
    const work = workMap.get(record.workId.toString())
    return {
      id: record._id.toString(),
      workId: record.workId.toString(),
      fileName: record.fileName,
      fileUrl: record.fileUrl,
      mediaType: record.mediaType,
      fileSize: record.fileSize,
      uploadedAt: record.createdAt.toISOString(),
      work: work
        ? {
            id: work._id.toString(),
            title: work.title,
            thumbnailUrl: work.thumbnailUrl ?? undefined,
          }
        : undefined,
    }
  })
  ctx.body = {
    total: data.length,
    records: data,
  }
}

export async function deleteUploadRecord(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  const { id } = ctx.params as { id: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid record id')
  }
  const result = await UploadRecordModel.findOneAndDelete({ _id: id, userId }).exec()
  if (!result) {
    ctx.throw(404, 'Record not found')
    return
  }
  ctx.body = { success: true }
}

export async function clearUploadRecords(ctx: Context): Promise<void> {
  const userId = ensureUserId(ctx)
  await UploadRecordModel.deleteMany({ userId }).exec()
  ctx.body = { success: true }
}
