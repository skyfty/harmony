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
  editorUser: {
    username: process.env.EDITOR_USER_USERNAME ?? 'editor',
    password: process.env.EDITOR_USER_PASSWORD ?? 'editor123',
    displayName: process.env.EDITOR_USER_DISPLAY_NAME ?? 'Editor 用户',
  },
  uploaderUser: {
    username: process.env.UPLOADER_USER_USERNAME ?? 'uploader',
    password: process.env.UPLOADER_USER_PASSWORD ?? 'uploader123',
    displayName: process.env.UPLOADER_USER_DISPLAY_NAME ?? '资源上传员',
  },
  miniProgramTestUser: {
    username: process.env.MINIPROGRAM_TEST_USER_USERNAME ?? 'test',
    password: process.env.MINIPROGRAM_TEST_USER_PASSWORD ?? 'test1234',
    displayName: process.env.MINIPROGRAM_TEST_USER_DISPLAY_NAME ?? 'Test Account',
  },
  openAi: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL,
    organization: process.env.OPENAI_ORG,
    project: process.env.OPENAI_PROJECT,
  },
  rootDir,
}
