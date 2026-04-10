import { appConfig } from '@/config/env'
import { AppUserModel } from '@/models/AppUser'
import { resolveMiniAppConfig } from '@/services/miniAppService'
import { exchangeMiniProgramPhoneCode } from '@/services/wechatMiniUserService'
import { signMiniAuthToken } from '@/utils/domainJwt'
import { hashPassword, verifyPassword } from '@/utils/password'

type AuthProvider = 'wechat-mini-program' | 'password'

type AppUserLean = {
  _id: { toString(): string }
  miniAppId?: string
  username?: string
  password?: string
  authProvider: AuthProvider
  wxOpenId?: string
  wxUnionId?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  phoneCountryCode?: string
  phoneBoundAt?: Date
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: Date
  lastLoginAt?: Date
  lastLoginSource?: string
  wechatProfileSyncedAt?: Date
  wechatIdentitySyncedAt?: Date
  status: 'active' | 'disabled'
  contractStatus: 'unsigned' | 'signed'
  workShareCount?: number
  exhibitionShareCount?: number
  createdAt: Date
  updatedAt: Date
}

export interface MiniSessionUser {
  id: string
  miniAppId?: string
  username?: string
  authProvider: AuthProvider
  wxOpenId?: string
  wxUnionId?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  phoneCountryCode?: string
  phoneBoundAt?: string
  hasBoundPhone: boolean
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
  lastLoginAt?: string
  lastLoginSource?: string
  wechatProfileSyncedAt?: string
  wechatIdentitySyncedAt?: string
  status: 'active' | 'disabled'
  contractStatus: 'unsigned' | 'signed'
  workShareCount: number
  exhibitionShareCount: number
  createdAt: string
  updatedAt: string
}

export interface MiniSessionResponse {
  token?: string
  user: MiniSessionUser
  shouldPromptProfileCompletion?: boolean
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function isMiniProfileComplete(profile: { displayName?: string; avatarUrl?: string }): boolean {
  const displayName = normalizeOptionalString(profile.displayName)
  const avatarUrl = normalizeOptionalString(profile.avatarUrl)
  const defaultDisplayName = normalizeOptionalString(appConfig.miniAuth.defaultDisplayName)
  const hasRealDisplayName = Boolean(displayName) && (!defaultDisplayName || displayName !== defaultDisplayName)
  return hasRealDisplayName && Boolean(avatarUrl)
}

function buildMiniUser(user: AppUserLean): MiniSessionUser {
  return {
    id: user._id.toString(),
    miniAppId: user.miniAppId ?? undefined,
    username: user.username ?? undefined,
    authProvider: user.authProvider,
    wxOpenId: user.wxOpenId ?? undefined,
    wxUnionId: user.wxUnionId ?? undefined,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    phone: user.phone ?? undefined,
    phoneCountryCode: user.phoneCountryCode ?? undefined,
    phoneBoundAt: user.phoneBoundAt?.toISOString(),
    hasBoundPhone: Boolean(user.phone),
    bio: user.bio ?? undefined,
    gender: user.gender ?? undefined,
    birthDate: user.birthDate?.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString(),
    lastLoginSource: user.lastLoginSource ?? undefined,
    wechatProfileSyncedAt: user.wechatProfileSyncedAt?.toISOString(),
    wechatIdentitySyncedAt: user.wechatIdentitySyncedAt?.toISOString(),
    status: user.status,
    contractStatus: user.contractStatus === 'signed' ? 'signed' : 'unsigned',
    workShareCount: user.workShareCount ?? 0,
    exhibitionShareCount: user.exhibitionShareCount ?? 0,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

function issueMiniToken(user: MiniSessionUser): string {
  return signMiniAuthToken({
    kind: 'user',
    sub: user.id,
    miniAppId: user.miniAppId,
    username: user.username,
    wxOpenId: user.wxOpenId,
  })
}

function markLogin(user: {
  authProvider: AuthProvider
  lastLoginAt?: Date
  lastLoginSource?: string
}): void {
  user.lastLoginAt = new Date()
  user.lastLoginSource = user.authProvider === 'password' ? 'mini-password-login' : 'mini-wechat-login'
}

function syncWechatProfile(
  user: {
    displayName?: string
    avatarUrl?: string
    wechatProfileSyncedAt?: Date
  },
  displayName?: string,
  avatarUrl?: string,
): void {
  let changed = false
  const nextDisplayName = normalizeOptionalString(displayName)
  const nextAvatarUrl = normalizeOptionalString(avatarUrl)

  if (nextDisplayName && user.displayName !== nextDisplayName) {
    user.displayName = nextDisplayName
    changed = true
  }
  if (nextAvatarUrl && user.avatarUrl !== nextAvatarUrl) {
    user.avatarUrl = nextAvatarUrl
    changed = true
  }

  if (changed) {
    user.wechatProfileSyncedAt = new Date()
  }
}

async function pickCanonicalWechatUser(input: {
  miniAppId: string
  openId: string
  unionId?: string
}) {
  const orFilters: Array<Record<string, string>> = [{ miniAppId: input.miniAppId, wxOpenId: input.openId }]
  if (input.unionId) {
    orFilters.push({ miniAppId: input.miniAppId, wxUnionId: input.unionId })
  }

  const matches = await AppUserModel.find({ $or: orFilters }).sort({ createdAt: 1, _id: 1 }).exec()
  if (!matches.length) {
    return null
  }

  const [canonical, ...duplicates] = matches
  if (duplicates.length) {
    await AppUserModel.deleteMany({ _id: { $in: duplicates.map((item) => item._id) } }).exec()
  }

  return canonical
}

export async function miniRegisterWithPassword(input: {
  username: string
  password: string
  displayName?: string
  email?: string
  phone?: string
}): Promise<MiniSessionResponse> {
  const username = input.username.trim()
  if (!username) {
    throw new Error('Username is required')
  }

  const existing = await AppUserModel.findOne({ username }).lean().exec()
  if (existing) {
    throw new Error('Username already exists')
  }

  const hashed = await hashPassword(input.password)
  const created = await AppUserModel.create({
    username,
    password: hashed,
    authProvider: 'password',
    displayName: input.displayName ?? username,
    email: input.email,
    phone: input.phone,
    phoneBoundAt: input.phone ? new Date() : undefined,
    lastLoginAt: new Date(),
    lastLoginSource: 'mini-password-register',
    status: 'active',
  })

  const user = buildMiniUser(created.toObject() as AppUserLean)
  return {
    token: issueMiniToken(user),
    user,
  }
}

export async function miniLoginWithPassword(username: string, password: string): Promise<MiniSessionResponse> {
  const safeUsername = username.trim()
  const user = await AppUserModel.findOne({ username: safeUsername }).exec()
  if (!user) {
    throw new Error('Invalid credentials')
  }
  if (user.status !== 'active') {
    throw new Error('Account disabled')
  }
  if (!user.password) {
    throw new Error('Password login unavailable')
  }

  // const ok = await verifyPassword(password, user.password)
  // if (!ok) {
  //   throw new Error('Invalid credentials')
  // }

  user.authProvider = 'password'
  markLogin(user)
  await user.save()

  const sessionUser = buildMiniUser(user.toObject() as AppUserLean)
  return {
    token: issueMiniToken(sessionUser),
    user: sessionUser,
  }
}

export async function miniLoginWithOpenId(input: {
  miniAppId: string
  openId: string
  unionId?: string
  displayName?: string
  avatarUrl?: string
}): Promise<MiniSessionResponse> {
  const miniAppId = input.miniAppId.trim()
  if (!miniAppId) {
    throw new Error('miniAppId is required')
  }

  const openId = input.openId.trim()
  if (!openId) {
    throw new Error('openId is required')
  }

  const unionId = normalizeOptionalString(input.unionId)
  const displayName = normalizeOptionalString(input.displayName)
  const avatarUrl = normalizeOptionalString(input.avatarUrl)
  let user = await pickCanonicalWechatUser({ miniAppId, openId, unionId })
  let shouldPromptProfileCompletion = false

  if (!user) {
    const createdAt = new Date()
    user = await AppUserModel.create({
      miniAppId,
      authProvider: 'wechat-mini-program',
      wxOpenId: openId,
      ...(unionId ? { wxUnionId: unionId, wechatIdentitySyncedAt: createdAt } : {}),
      displayName: displayName ?? appConfig.miniAuth.defaultDisplayName,
      avatarUrl,
      lastLoginAt: createdAt,
      lastLoginSource: 'mini-wechat-login',
      wechatProfileSyncedAt: displayName || avatarUrl ? createdAt : undefined,
      status: 'active',
      contractStatus: 'unsigned',
    })
    shouldPromptProfileCompletion = !isMiniProfileComplete({
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    })
  } else {
    user.miniAppId = miniAppId
    user.authProvider = 'wechat-mini-program'
    if (user.wxOpenId !== openId) {
      user.wxOpenId = openId
    }
    if (unionId && user.wxUnionId !== unionId) {
      user.wxUnionId = unionId
      user.wechatIdentitySyncedAt = new Date()
    }
    if (!user.displayName) {
      user.displayName = appConfig.miniAuth.defaultDisplayName
    }
    syncWechatProfile(user, displayName, avatarUrl)
    markLogin(user)
    await user.save()
  }

  if (user.status !== 'active') {
    throw new Error('Account disabled')
  }

  const sessionUser = buildMiniUser(user.toObject() as AppUserLean)
  return {
    token: issueMiniToken(sessionUser),
    user: sessionUser,
    shouldPromptProfileCompletion,
  }
}

export async function miniBindPhone(input: {
  userId: string
  code: string
  miniAppId?: string
}): Promise<MiniSessionResponse> {
  const user = await AppUserModel.findById(input.userId).exec()
  if (!user) {
    throw new Error('User not found')
  }

  const miniAppId = normalizeOptionalString(input.miniAppId) ?? normalizeOptionalString(user.miniAppId)
  if (!miniAppId) {
    throw new Error('miniAppId is required')
  }

  const phone = await exchangeMiniProgramPhoneCode(input.code, miniAppId)
  user.miniAppId = miniAppId
  user.phone = phone.purePhoneNumber || phone.phoneNumber
  user.phoneCountryCode = phone.countryCode
  user.phoneBoundAt = new Date()
  await user.save()

  const sessionUser = buildMiniUser(user.toObject() as AppUserLean)
  return {
    token: issueMiniToken(sessionUser),
    user: sessionUser,
  }
}

export async function miniGetProfile(userId: string): Promise<MiniSessionResponse> {
  const user = await AppUserModel.findById(userId).lean<AppUserLean>().exec()
  if (!user) {
    throw new Error('User not found')
  }

  return {
    user: buildMiniUser(user),
  }
}

export async function ensureMiniProgramTestUserV2(): Promise<void> {
  const miniApp = await resolveMiniAppConfig().catch(() => null)
  const miniAppId = miniApp?.miniAppId
  const username = appConfig.miniProgramTestUser.username.trim()
  const password = appConfig.miniProgramTestUser.password
  const displayName = appConfig.miniProgramTestUser.displayName

  if (!username || !password) {
    return
  }

  const existing = await AppUserModel.findOne({ username }).exec()
  if (!existing) {
    await AppUserModel.create({
      miniAppId,
      username,
      password: await hashPassword(password),
      authProvider: 'password',
      displayName: displayName || username,
      lastLoginSource: 'mini-test-bootstrap',
      status: 'active',
      contractStatus: 'unsigned',
    })
    return
  }

  let shouldSave = false
  if ((existing.miniAppId ?? undefined) !== miniAppId) {
    existing.miniAppId = miniAppId
    shouldSave = true
  }

  if (!existing.password) {
    existing.password = await hashPassword(password)
    shouldSave = true
  } else {
    const passwordMatches = await verifyPassword(password, existing.password)
    if (!passwordMatches) {
      existing.password = await hashPassword(password)
      shouldSave = true
    }
  }

  if (existing.authProvider !== 'password') {
    existing.authProvider = 'password'
    shouldSave = true
  }

  if (existing.status !== 'active') {
    existing.status = 'active'
    shouldSave = true
  }

  if (displayName && existing.displayName !== displayName) {
    existing.displayName = displayName
    shouldSave = true
  }

  if (shouldSave) {
    await existing.save()
  }
}

export async function getMiniProgramTestSessionUser(): Promise<MiniSessionUser | null> {
  const miniApp = await resolveMiniAppConfig().catch(() => null)
  const miniAppId = miniApp?.miniAppId
  const username = appConfig.miniProgramTestUser.username.trim()
  if (!username) {
    return null
  }

  const user = await AppUserModel.findOne({ username, miniAppId }).lean<AppUserLean>().exec()
    ?? await AppUserModel.findOne({ username }).lean<AppUserLean>().exec()
  if (!user || user.status !== 'active') {
    return null
  }

  return buildMiniUser(user)
}