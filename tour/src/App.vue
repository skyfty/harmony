<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { initializeMiniAuth, prewarmMiniAuth } from '@/api/mini/session';

onLaunch(() => {
  initializeMiniAuth();
  console.log("App Launch");
});
onShow(() => {
  void prewarmMiniAuth();
  console.log("App Show");
});
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
