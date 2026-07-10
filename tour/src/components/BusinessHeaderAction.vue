<template>
  <view class="header-action" @tap="emit('tap')">
    <view class="header-action__icon" aria-hidden="true" />
  </view>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (event: 'tap'): void
}>()
</script>

<style scoped lang="scss">
.header-action {
  width: 30px;
  height: 30px;
  border-radius: 15px;
  background: linear-gradient(135deg, #ffb155 0%, #ff7a18 55%, #ff5f00 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.header-action__icon {
  position: relative;
  width: 14px;
  height: 14px;
}

.header-action__icon::before,
.header-action__icon::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border-radius: 999px;
}

.header-action__icon::before {
  width: 14px;
  height: 2px;
}

.header-action__icon::after {
  width: 2px;
  height: 14px;
}
</style>
