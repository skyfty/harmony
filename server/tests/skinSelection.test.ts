import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from 'koa'
import { Types } from 'mongoose'
import { unsetCurrentSkin } from '../src/controllers/miniprogram/skinController'
import { SkinModel } from '../src/models/Skin'
import { UserSkinSelectionModel } from '../src/models/UserSkinSelection'

type SelectionRecord = {
  userId: string
  skinId: Types.ObjectId
}

function valueOfId(value: unknown): string {
  return value && typeof (value as { toString?: unknown }).toString === 'function'
    ? (value as { toString(): string }).toString()
    : String(value ?? '')
}

function createContext(userId: string, skinId: string): Context {
  return {
    params: { id: skinId },
    state: { user: { id: userId } },
    throw(status: number, message = '') {
      const error = new Error(message) as Error & { status: number }
      error.status = status
      throw error
    },
  } as unknown as Context
}

function stubSkinLookup(skin: { _id: Types.ObjectId; categoryId: Types.ObjectId } | null): () => void {
  const original = SkinModel.findById
  ;(SkinModel as any).findById = () => ({
    select() {
      return this
    },
    lean() {
      return this
    },
    async exec() {
      return skin
    },
  })
  return () => {
    SkinModel.findById = original
  }
}

function stubSelections(selections: SelectionRecord[]): () => void {
  const original = UserSkinSelectionModel.deleteOne
  ;(UserSkinSelectionModel as any).deleteOne = (filter: { userId: string; skinId: unknown }) => ({
    async exec() {
      const skinId = valueOfId(filter.skinId)
      const index = selections.findIndex((entry) => (
        entry.userId === filter.userId && entry.skinId.toString() === skinId
      ))
      if (index < 0) {
        return { deletedCount: 0 }
      }
      selections.splice(index, 1)
      return { deletedCount: 1 }
    },
  })
  return () => {
    UserSkinSelectionModel.deleteOne = original
  }
}

test('unset skin removes only the current user exact selection and is idempotent', async () => {
  const userId = new Types.ObjectId().toString()
  const otherUserId = new Types.ObjectId().toString()
  const categoryId = new Types.ObjectId()
  const skinId = new Types.ObjectId()
  const otherSkinId = new Types.ObjectId()
  const selections: SelectionRecord[] = [
    { userId, skinId },
    { userId, skinId: otherSkinId },
    { userId: otherUserId, skinId },
  ]

  const restoreSkin = stubSkinLookup({ _id: skinId, categoryId })
  const restoreSelections = stubSelections(selections)
  try {
    const firstContext = createContext(userId, skinId.toString())
    await unsetCurrentSkin(firstContext)
    assert.deepEqual(firstContext.body, {
      success: true,
      categoryId: categoryId.toString(),
      skinId: skinId.toString(),
    })

    const secondContext = createContext(userId, skinId.toString())
    await unsetCurrentSkin(secondContext)
    assert.deepEqual(secondContext.body, firstContext.body)

    assert.deepEqual(selections, [
      { userId, skinId: otherSkinId },
      { userId: otherUserId, skinId },
    ])
  } finally {
    restoreSelections()
    restoreSkin()
  }
})

test('unset skin rejects invalid and unknown skins', async () => {
  const userId = new Types.ObjectId().toString()
  await assert.rejects(
    unsetCurrentSkin(createContext(userId, 'not-an-object-id')),
    (error: unknown) => (error as { status?: number }).status === 400,
  )

  const skinId = new Types.ObjectId().toString()
  const restoreSkin = stubSkinLookup(null)
  try {
    await assert.rejects(
      unsetCurrentSkin(createContext(userId, skinId)),
      (error: unknown) => (error as { status?: number }).status === 404,
    )
  } finally {
    restoreSkin()
  }
})
