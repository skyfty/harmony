<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
import { ensureTestAccountLogin } from "@/utils/testAccount";

onLaunch(() => {
  ensureTestAccountLogin().catch((error) => {
    console.warn("Test account bootstrap failed", error);
  });
  console.log("App Launch");
});
onShow(() => {
  console.log("App Show");
});
onHide(() => {
  console.log("App Hide");
});
</script>
<style>
.page-container{
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

/* page-level padding handled by individual views */
</style>
