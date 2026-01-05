<template>
  <view
    v-if="visible"
    class="viewer-drive-console viewer-drive-console--mobile"
  >
    <view class="viewer-drive-cluster viewer-drive-cluster--actions">
      <button
        class="viewer-drive-icon-button"
        :class="{ 'is-busy': resetBusy }"
        type="button"
        hover-class="none"
        :disabled="resetBusy"
        aria-label="重置车辆"
        @tap="handleResetTap"
      >
        <view class="viewer-drive-icon" aria-hidden="true">
          <text class="viewer-drive-icon-text">🔄</text>
        </view>
      </button>
      <button
        class="viewer-drive-icon-button viewer-drive-icon-button--danger"
        :class="{ 'is-busy': exitBusy }"
        :disabled="exitBusy"
        type="button"
        hover-class="none"
        aria-label="下车"
        @tap="handleExitTap"
      >
        <view class="viewer-drive-icon" aria-hidden="true">
          <text class="viewer-drive-icon-text">🚪</text>
        </view>
      </button>
    </view>
    <view
      v-show="drivePadState.visible"
      class="viewer-drive-cluster viewer-drive-cluster--joystick viewer-drive-cluster--floating"
      :class="{ 'is-fading': drivePadState.fading }"
      :style="drivePadStyle"
    >
      <view
        id="viewer-drive-joystick"
        class="viewer-drive-joystick"
        :class="{ 'is-active': joystickActive }"
        role="slider"
        aria-label="驾驶摇杆"
        aria-valuemin="-100"
        aria-valuemax="100"
        :aria-valuenow="Math.round(throttle * 100)"
        @touchstart.stop.prevent="handleJoystickTouchStart"
        @touchmove.stop.prevent="handleJoystickTouchMove"
        @touchend.stop.prevent="handleJoystickTouchEnd"
        @touchcancel.stop.prevent="handleJoystickTouchEnd"
      >
        <view class="viewer-drive-joystick__base"></view>
        <view class="viewer-drive-joystick__stick" :style="joystickKnobStyle"></view>
      </view>
    </view>
  </view>
  <view
    v-if="visible"
    class="viewer-drive-speed-floating"
    aria-hidden="true"
  >
    <view class="viewer-drive-speed-gauge" :style="speedGaugeStyle">
      <view class="viewer-drive-speed-gauge__needle"></view>
    </view>
    <view class="viewer-drive-speed-gauge__values">
      <text class="viewer-drive-speed-gauge__value">{{ speedKmh }}</text>
      <text class="viewer-drive-speed-gauge__unit">km/h</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

defineProps<{
  visible: boolean;
  resetBusy: boolean;
  exitBusy: boolean;
  drivePadState: { visible: boolean; fading: boolean };
  drivePadStyle: any;
  joystickActive: boolean;
  throttle: number;
  joystickKnobStyle: any;
  speedGaugeStyle: any;
  speedKmh: string;
}>();

const emit = defineEmits<{
  (e: 'reset'): void;
  (e: 'exit'): void;
  (e: 'joystickTouchStart', event: any): void;
  (e: 'joystickTouchMove', event: any): void;
  (e: 'joystickTouchEnd', event: any): void;
}>();

const handleResetTap = () => emit('reset');
const handleExitTap = () => emit('exit');
const handleJoystickTouchStart = (event: any) => emit('joystickTouchStart', event);
const handleJoystickTouchMove = (event: any) => emit('joystickTouchMove', event);
const handleJoystickTouchEnd = (event: any) => emit('joystickTouchEnd', event);
</script>

<style lang="scss" scoped>
:root {
  --viewer-safe-area-top: 0px;
}

@supports (padding: env(safe-area-inset-top)) {
  :root {
    --viewer-safe-area-top: env(safe-area-inset-top);
  }
}

@supports (padding: constant(safe-area-inset-top)) {
  :root {
    --viewer-safe-area-top: constant(safe-area-inset-top);
  }
}

.viewer-drive-console {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1550;
}

.viewer-drive-cluster {
  position: absolute;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
}

.viewer-drive-console--mobile .viewer-drive-cluster {
  max-width: none;
}

.viewer-drive-cluster--joystick {
  left: 16px;
  bottom: 16px;
  align-items: center;
}

.viewer-drive-cluster--floating {
  left: 0;
  top: 0;
  bottom: auto;
  transform: translate(-50%, -50%);
  transition: opacity 0.24s ease;
}

.viewer-drive-cluster--floating.is-fading {
  opacity: 0;
}

.viewer-drive-cluster--actions {
  right: 16px;
  top: calc(30% + var(--viewer-safe-area-top, 0px));
  transform: translateY(-50%);
  align-items: flex-end;
  flex-direction: column;
  gap: 12px;
}

.viewer-drive-icon-button {
  min-width: 48px;
  min-height: 48px;
  padding: 6px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(8, 12, 28, 0.48);
  color: #f4f6ff;
  box-shadow: 0 10px 24px rgba(4, 6, 18, 0.45);
  backdrop-filter: blur(12px);
  transition: background-color 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
}

.viewer-drive-icon-button--danger {
  background-color: rgba(74, 6, 24, 0.6);
  border-color: rgba(255, 143, 167, 0.45);
  color: #ffe5ea;
}

.viewer-drive-icon-button.is-busy,
.viewer-drive-icon-button:disabled {
  opacity: 0.7;
}

.viewer-drive-icon-button:active {
  transform: scale(0.95);
}

.viewer-drive-speed-floating {
  position: absolute;
  left: 24px;
  bottom: 190px;
  z-index: 1580;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}

.viewer-drive-speed-gauge {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background:
    conic-gradient(from -90deg, rgba(102, 210, 255, 0.65) var(--speed-angle, 0deg), rgba(255, 255, 255, 0.04) var(--speed-angle, 0deg));
  background-color: rgba(6, 10, 24, 0.28);
  position: relative;
  box-shadow:
    inset 0 0 14px rgba(0, 0, 0, 0.32),
    0 14px 28px rgba(3, 6, 18, 0.35);
  backdrop-filter: blur(8px);
}

.viewer-drive-speed-gauge::after {
  content: '';
  position: absolute;
  inset: 14%;
  border-radius: 50%;
  background: rgba(4, 6, 18, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.12);
  pointer-events: none;
  z-index: 0;
}

.viewer-drive-speed-gauge__needle {
  position: absolute;
  bottom: 50%;
  left: 50%;
  width: 2px;
  height: 36px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(67, 221, 255, 0.8));
  border-radius: 1px;
  transform-origin: center bottom;
  transform: translateX(-50%) rotate(calc(var(--speed-angle, 0deg) - 90deg));
  box-shadow: 0 0 10px rgba(78, 227, 255, 0.5);
  z-index: 2;
}

.viewer-drive-speed-gauge__values {
  color: #f7fbff;
  font-weight: 700;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 0.8rem;
}

.viewer-drive-speed-gauge__value {
  font-size: 1.3rem;
}

.viewer-drive-speed-gauge__unit {
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.8;
}

.viewer-drive-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: currentColor;
}

.viewer-drive-icon-text {
  font-size: 20px;
  line-height: 1;
}

.viewer-drive-joystick {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  position: relative;
  pointer-events: auto;
  transition: transform 0.18s ease;
}

.viewer-drive-joystick::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, rgba(77, 113, 255, 0.12), transparent 62%),
    rgba(18, 28, 64, 0.45);
  border: 2px solid rgba(124, 156, 255, 0.3);
  box-shadow:
    inset 0 0 22px rgba(10, 18, 48, 0.85),
    0 0 28px rgba(32, 80, 220, 0.32);
  backdrop-filter: blur(6px);
}

.viewer-drive-joystick__base {
  position: absolute;
  inset: 16px;
  border-radius: 50%;
  background: rgba(50, 72, 148, 0.18);
  box-shadow: inset 0 0 18px rgba(12, 18, 42, 0.8);
}

.viewer-drive-joystick__stick {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.2), transparent 58%),
    rgba(78, 118, 230, 0.75);
  border: 2px solid rgba(150, 188, 255, 0.4);
  box-shadow:
    inset 0 0 14px rgba(18, 26, 58, 0.8),
    0 8px 18px rgba(10, 12, 28, 0.45);
  transform: translate(-50%, -50%);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.viewer-drive-joystick.is-active {
  transform: scale(0.97);
}

.viewer-drive-joystick.is-active .viewer-drive-joystick__stick {
  box-shadow:
    inset 0 0 18px rgba(18, 26, 58, 0.95),
    0 10px 22px rgba(18, 22, 44, 0.6);
}
</style>
