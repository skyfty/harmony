import { getAccessToken } from '@/api/mini/token'
import { setPendingRecoveryProfile, ensureMiniAuth } from '@/api/mini/session'
import { redirectToNav } from '@/utils/navKey'

export async function ensureAuthThenNavigate(key: string): Promise<boolean> {
  try {
    if (getAccessToken()) {
      // already logged in
      redirectToNav(key as any)
      return true
    }

    // prompt user for profile (must be a user gesture)
    const res: any = await new Promise((resolve, reject) => {
      // @ts-ignore
      ;(uni as any).getUserProfile({
        desc: '用于完成账号注册与头像同步',
        success: (r: any) => resolve(r),
        fail: (e: any) => reject(e),
      })
    })

    const displayName = res?.userInfo?.nickName
    const avatarUrl = res?.userInfo?.avatarUrl
    setPendingRecoveryProfile({ displayName, avatarUrl })

    // perform auth (will include pending profile in login request)
    await ensureMiniAuth()
    redirectToNav(key as any)
    return true
  } catch (err) {
    // user cancelled or login failed
    try {
      // fallback: still navigate to target page without auth
      redirectToNav(key as any)
    } catch {}
    return false
  }
}

export async function requestProfileAndSync(): Promise<boolean> {
  try {
    const res: any = await new Promise((resolve, reject) => {
      // @ts-ignore
      ;(uni as any).getUserProfile({
        desc: '用于同步昵称与头像',
        success: (r: any) => resolve(r),
        fail: (e: any) => reject(e),
      })
    })

    const displayName = res?.userInfo?.nickName
    const avatarUrl = res?.userInfo?.avatarUrl
    setPendingRecoveryProfile({ displayName, avatarUrl })
    await ensureMiniAuth(true)
    return true
  } catch (err) {
    return false
  }
}
