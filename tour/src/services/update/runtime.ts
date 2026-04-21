const UPDATE_RUNTIME_LOG_PREFIX = '[mini-update-runtime]'

const UPDATE_HIGHLIGHTS = [
  '优化启动阶段的更新提醒与重启流程',
  '提升首页与登录场景的整体稳定性',
  '修复已知问题并改进细节体验',
]

let miniProgramUpdateRuntimeInstalled = false
let miniProgramUpdatePromptShown = false

function logMiniProgramUpdate(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${UPDATE_RUNTIME_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${UPDATE_RUNTIME_LOG_PREFIX} ${message}`, details)
}

function getUpdateManager(): WechatMiniprogram.UpdateManager | null {
  if (typeof wx === 'undefined' || typeof wx.getUpdateManager !== 'function') {
    logMiniProgramUpdate('update manager unavailable in current runtime')
    return null
  }

  if (typeof uni !== 'undefined' && typeof uni.canIUse === 'function' && !uni.canIUse('getUpdateManager')) {
    logMiniProgramUpdate('update manager unsupported by current platform capability')
    return null
  }

  try {
    return wx.getUpdateManager()
  } catch (error) {
    logMiniProgramUpdate('failed to create update manager', error)
    return null
  }
}

function formatUpdateHighlights(): string {
  return UPDATE_HIGHLIGHTS.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

async function promptForUpdate(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    wx.showModal({
      title: '发现新版本',
      content: `建议更新到最新版本后继续使用。\n\n本次更新亮点：\n${formatUpdateHighlights()}`,
      confirmText: '立即重启',
      cancelText: '稍后再说',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    })
  })
}

export function installMiniProgramUpdateRuntime(): void {
  if (miniProgramUpdateRuntimeInstalled) {
    logMiniProgramUpdate('install skipped, runtime already installed')
    return
  }

  miniProgramUpdateRuntimeInstalled = true

  const updateManager = getUpdateManager()
  if (!updateManager) {
    return
  }

  logMiniProgramUpdate('install runtime start')
  updateManager.onCheckForUpdate((result) => {
    logMiniProgramUpdate('checked for update', { hasUpdate: Boolean(result.hasUpdate) })
  })

  updateManager.onUpdateReady(async () => {
    if (miniProgramUpdatePromptShown) {
      logMiniProgramUpdate('update prompt already shown, skip duplicate ready event')
      return
    }

    miniProgramUpdatePromptShown = true
    logMiniProgramUpdate('update ready, asking user for confirmation')

    try {
      const confirmed = await promptForUpdate()
      if (!confirmed) {
        logMiniProgramUpdate('user postponed update')
        return
      }

      logMiniProgramUpdate('user confirmed update, applying update')
      updateManager.applyUpdate()
    } catch (error) {
      logMiniProgramUpdate('failed while prompting for update', error)
    }
  })

  updateManager.onUpdateFailed(() => {
    logMiniProgramUpdate('update download failed')
  })
}
