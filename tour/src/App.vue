<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initializeMiniAuth, recoverMiniAuthSession } from '@/api/mini/session';
import { setMiniAuthRecoveryHandler } from '@harmony/utils'
import { setPendingRecoveryProfile } from '@/api/mini/session'
import { showRecoveryModal } from '@/stores/miniAuthRecovery'
import { normalizeMiniProfileText, setAnonymousDisplayEnabled } from '@/utils/miniProfile'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'

setMiniAuthRecoveryHandler(async () => {
  try {
    const result = await showRecoveryModal({
      title: '登录已失效',
      description: '请补充微信头像和昵称后重新完成登录；如果暂时不想授权，也可以先匿名使用。',
      confirmText: '继续登录',
      skipText: '匿名继续',
    })
    if (result.action === 'submit') {
      setAnonymousDisplayEnabled(false)
      setPendingRecoveryProfile({
        displayName: normalizeMiniProfileText(result.displayName),
        avatarFilePath: result.avatarFilePath,
      })
    } else {
      setPendingRecoveryProfile(null)
      setAnonymousDisplayEnabled(true)
    }

    return await recoverMiniAuthSession()
  } catch(e) {
    console.error("Error during mini auth recovery:", e)
    return false
  }
})

onLaunch(() => {
  initializeMiniAuth();
});
// Do not automatically prewarm auth on every app show to avoid
// unintended temporary account registrations when returning to home.
// onShow(() => {
//   void prewarmMiniAuth();
// });
onHide(() => {
  console.log("App Hide");
});
</script>
<template>
  <MiniAuthRecovery />
</template>
<style>
:root {
  --page-toolbar-offset: 64px;
}

.page-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* page-level padding handled by individual views */
</style>
