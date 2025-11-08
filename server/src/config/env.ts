import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const appConfig = {
  isDevelopment: process.env.NODE_ENV !== 'production',
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/harmony',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  assetStoragePath: path.resolve(process.cwd(), process.env.ASSET_STORAGE_PATH ?? './uploads'),
  assetPublicUrl: process.env.ASSET_PUBLIC_URL ?? 'http://localhost:4000/uploads',
  editorPublicUrl: process.env.EDITOR_PUBLIC_URL ?? 'http://localhost:5173',
  testUser: {
    username: process.env.TEST_USER_USERNAME ?? 'test',
    password: process.env.TEST_USER_PASSWORD ?? 'test1234',
    displayName: process.env.TEST_USER_DISPLAY_NAME ?? 'Test Account',
  },
  rootDir,
}
