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
  adminAuth: {
    jwtSecret: process.env.ADMIN_JWT_SECRET ?? process.env.JWT_SECRET ?? 'change-me-admin',
    issuer: process.env.ADMIN_JWT_ISSUER ?? 'harmony-admin',
    audience: process.env.ADMIN_JWT_AUDIENCE ?? 'harmony-admin-api',
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '12h',
    seed: {
      username: process.env.ADMIN_SEED_USERNAME ?? 'admin',
      password: process.env.ADMIN_SEED_PASSWORD ?? 'admin123',
      displayName: process.env.ADMIN_SEED_DISPLAY_NAME ?? '系统管理员',
    },
  },
  miniAuth: {
    jwtSecret: process.env.MINI_JWT_SECRET ?? 'change-me-mini',
    issuer: process.env.MINI_JWT_ISSUER ?? 'harmony-mini',
    audience: process.env.MINI_JWT_AUDIENCE ?? 'harmony-mini-api',
    expiresIn: process.env.MINI_JWT_EXPIRES_IN ?? '12h',
    defaultDisplayName: process.env.MINI_DEFAULT_DISPLAY_NAME ?? '微信用户',
    allowTestBypassInNonProd: process.env.MINI_AUTH_ALLOW_TEST_BYPASS_IN_NON_PROD
      ? process.env.MINI_AUTH_ALLOW_TEST_BYPASS_IN_NON_PROD === 'true'
      : true,
  },
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
  multiuserPort: Number(process.env.MULTIUSER_PORT ?? 7645),
  openAi: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL,
    organization: process.env.OPENAI_ORG,
    project: process.env.OPENAI_PROJECT,
  },
  rootDir,
}
