import { AppUserModel } from '@/models/AppUser'

export const APP_USER_WECHAT_UNION_INDEX_NAME = 'miniAppId_1_wxUnionId_1'

const APP_USER_WECHAT_UNION_INDEX_KEYS = {
  miniAppId: 1,
  wxUnionId: 1,
} as const

const APP_USER_WECHAT_UNION_PARTIAL_FILTER = {
  wxUnionId: {
    $type: 'string',
    $gt: '',
  },
} as const

type MongoIndexInfo = {
  name?: string
  key?: Record<string, number>
  unique?: boolean
  sparse?: boolean
  partialFilterExpression?: {
    wxUnionId?: {
      $type?: string
      $gt?: string
    }
  }
}

function hasExpectedUnionIndexShape(index: MongoIndexInfo | undefined): boolean {
  const unionFilter = index?.partialFilterExpression?.wxUnionId
  return Boolean(index?.unique && unionFilter?.$type === 'string' && unionFilter.$gt === '')
}

export async function ensureAppUserWechatIndexes(): Promise<void> {
  const indexes = (await AppUserModel.collection.indexes()) as MongoIndexInfo[]
  const existingUnionIndex = indexes.find((index) => index.name === APP_USER_WECHAT_UNION_INDEX_NAME)

  if (hasExpectedUnionIndexShape(existingUnionIndex)) {
    return
  }

  if (existingUnionIndex?.name) {
    await AppUserModel.collection.dropIndex(existingUnionIndex.name)
    console.log(`[app-user-indexes] dropped legacy index ${existingUnionIndex.name}`)
  }

  await AppUserModel.collection.createIndex(APP_USER_WECHAT_UNION_INDEX_KEYS, {
    name: APP_USER_WECHAT_UNION_INDEX_NAME,
    unique: true,
    partialFilterExpression: APP_USER_WECHAT_UNION_PARTIAL_FILTER,
  })

  console.log(`[app-user-indexes] ensured partial unique index ${APP_USER_WECHAT_UNION_INDEX_NAME}`)
}