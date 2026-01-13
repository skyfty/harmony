<script setup lang="ts">
import type { ExitSceneBehaviorParams } from '@harmony/schema'

defineProps<{
  modelValue: ExitSceneBehaviorParams | undefined
}>()
</script>

<template>
  <div class="exit-scene-params">
    <div class="exit-scene-params__hint">无参数：执行后会退出当前场景并返回上一层。</div>
  </div>
</template>

<style scoped>
.exit-scene-params {
  display: flex;
  flex-direction: column;
}

.exit-scene-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
