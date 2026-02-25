import { appConfig } from '@/config/env'
import { AppUserModel } from '@/models/AppUser'
import { signMiniAuthToken } from '@/utils/domainJwt'
import { hashPassword, verifyPassword } from '@/utils/password'

type AppUserLean = {
  _id: { toString(): string }
  username?: string
  password?: string
  wxOpenId?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: Date
  status: 'active' | 'disabled'
  workShareCount?: number
  exhibitionShareCount?: number
  createdAt: Date
  updatedAt: Date
}

export interface MiniSessionUser {
  id: string
  username?: string
  wxOpenId?: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
  status: 'active' | 'disabled'
  workShareCount: number
  exhibitionShareCount: number
  createdAt: string
  updatedAt: string
}

export interface MiniSessionResponse {
  token?: string
  user: MiniSessionUser
}

function buildMiniUser(user: AppUserLean): MiniSessionUser {
  return {
    id: user._id.toString(),
    username: user.username ?? undefined,
    wxOpenId: user.wxOpenId ?? undefined,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    phone: user.phone ?? undefined,
    bio: user.bio ?? undefined,
    gender: user.gender ?? undefined,
    birthDate: user.birthDate?.toISOString(),
    status: user.status,
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
    username: user.username,
    wxOpenId: user.wxOpenId,
  })
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
    displayName: input.displayName ?? username,
    email: input.email,
    phone: input.phone,
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
  const user = await AppUserModel.findOne({ username: safeUsername }).lean<AppUserLean>().exec()
  if (!user) {
    throw new Error('Invalid credentials')
  }
  if (user.status !== 'active') {
    throw new Error('Account disabled')
  }
  if (!user.password) {
    throw new Error('Password login unavailable')
  }
  const ok = await verifyPassword(password, user.password)
  if (!ok) {
    throw new Error('Invalid credentials')
  }
  const sessionUser = buildMiniUser(user)
  return {
    token: issueMiniToken(sessionUser),
    user: sessionUser,
  }
}

export async function miniLoginWithOpenId(input: {
  openId: string
  displayName?: string
  avatarUrl?: string
}): Promise<MiniSessionResponse> {
  const openId = input.openId.trim()
  if (!openId) {
    throw new Error('openId is required')
  }

  let user = await AppUserModel.findOne({ wxOpenId: openId }).exec()
  if (!user) {
    user = await AppUserModel.create({
      wxOpenId: openId,
      displayName: input.displayName ?? appConfig.miniAuth.defaultDisplayName,
      avatarUrl: input.avatarUrl,
      status: 'active',
    })
  }

  if (user.status !== 'active') {
    throw new Error('Account disabled')
  }

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
  const username = appConfig.miniProgramTestUser.username
  const password = appConfig.miniProgramTestUser.password
  const displayName = appConfig.miniProgramTestUser.displayName

  if (!username || !password) {
    return
  }

  const existing = await AppUserModel.findOne({ username }).exec()
  if (!existing) {
    await AppUserModel.create({
      username,
      password: await hashPassword(password),
      displayName: displayName || username,
      status: 'active',
    })
    return
  }

  let shouldSave = false
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
  const username = appConfig.miniProgramTestUser.username.trim()
  if (!username) {
    return null
  }

  const user = await AppUserModel.findOne({ username }).lean<AppUserLean>().exec()
  if (!user || user.status !== 'active') {
    return null
  }

  return buildMiniUser(user)
}
