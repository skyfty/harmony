<script setup lang="ts">
import { onLaunch, onHide } from "@dcloudio/uni-app";
import { initializeMiniAuth } from '@/api/mini/session';
import { installMiniAuthRuntime } from '@/services/miniAuth/runtime'
import { installMiniProgramUpdateRuntime } from '@/services/update/runtime'

installMiniAuthRuntime()
installMiniProgramUpdateRuntime()

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
