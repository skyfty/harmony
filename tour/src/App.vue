<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initializeMiniAuth, prewarmMiniAuth } from '@/api/mini/session';
import { setMiniAuthRecoveryHandler } from '@harmony/utils'
import { showRecoveryModal } from '@/stores/miniAuthRecovery'
import { setPendingRecoveryProfile } from '@/api/mini/session'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'

// Register a recovery handler that will show a modal prompting the user
// to tap a button to authorize profile access. The modal's button will
// call `uni.getUserProfile` (user gesture) and resolve with the profile.
setMiniAuthRecoveryHandler(async () => {
  try {
    const result = await showRecoveryModal()
    if (result && result.success) {
      setPendingRecoveryProfile({ displayName: result.displayName, avatarUrl: result.avatarUrl })
      return true
    }
    return false
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
