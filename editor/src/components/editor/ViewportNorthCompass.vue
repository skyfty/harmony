<template>
  <div
    class="viewport-north-compass"
    :style="compassStyle"
    role="img"
    :aria-label="`Camera heading ${Math.round(headingDegrees)} degrees from north`"
  >
    <div class="viewport-north-compass__ring" />
    <div class="viewport-north-compass__ticks">
      <span
        v-for="tick in ticks"
        :key="tick.key"
        class="viewport-north-compass__tick"
        :class="{ 'is-major': tick.major }"
        :style="tick.style"
      />
    </div>
    <div class="viewport-north-compass__label-slot">
      <span class="viewport-north-compass__label">N</span>
    </div>
    <div class="viewport-north-compass__needle" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  headingDegrees: number
}>()

const ticks = Array.from({ length: 12 }, (_, index) => ({
  key: `north-compass-tick-${index}`,
  major: index % 3 === 0,
  style: {
    transform: `translateX(-50%) rotate(${index * 30}deg)`,
  },
}))

const compassStyle = computed(() => ({
  '--north-heading': `${props.headingDegrees}deg`,
}))
</script>

<style scoped>
.viewport-north-compass {
  width: 40px;
  height: 40px;
  position: relative;
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background:
    radial-gradient(circle at 30% 24%, rgba(120, 208, 255, 0.12), transparent 34%),
    radial-gradient(circle at 68% 72%, rgba(255, 255, 255, 0.08), transparent 42%),
    linear-gradient(145deg, rgba(10, 14, 20, 0.30), rgba(10, 14, 20, 0.22));
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(255, 255, 255, 0.16),
    inset 0 0 12px rgba(255, 255, 255, 0.08),
    inset 0 -8px 12px rgba(194, 220, 247, 0.08);
  backdrop-filter: blur(8px) saturate(130%);
}

.viewport-north-compass__ring {
  position: absolute;
  inset: 8%;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02) 58%, rgba(255, 255, 255, 0) 72%);
}

.viewport-north-compass__ticks {
  position: absolute;
  inset: 0;
}

.viewport-north-compass__tick {
  position: absolute;
  top: 4px;
  left: 50%;
  width: 1px;
  height: 3px;
  border-radius: 999px;
  background: rgba(185, 205, 226, 0.24);
  transform-origin: center 16px;
  z-index: 1;
}

.viewport-north-compass__tick.is-major {
  height: 5px;
  background: rgba(94, 161, 255, 0.62);
}

.viewport-north-compass__label-slot {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.viewport-north-compass__label {
  position: absolute;
  top: 3px;
  left: 50%;
  font-size: 0.5rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgba(236, 241, 248, 0.88);
  text-shadow: none;
  transform: translateX(-50%);
}

.viewport-north-compass__needle {
  position: absolute;
  inset: 0;
  transform: rotate(var(--north-heading, 0deg));
  transform-origin: center center;
  z-index: 2;
}

.viewport-north-compass__needle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 16px;
  width: 2px;
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(102, 178, 255, 0.88), rgba(71, 149, 255, 0.82));
  box-shadow: none;
  transform: translateX(-50%);
}

.viewport-north-compass__needle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 11px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 7px solid rgba(102, 178, 255, 0.92);
  filter: none;
  transform: translateX(-50%);
}
</style>
