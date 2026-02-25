<template>
  <view
    class="coupon-card"
    :class="{ 'coupon-card--inactive': status !== 'unused' }"
  >
    <!-- Left: colored type area -->
    <view
      class="coupon-left"
      :style="{ background: themeGradient }"
    >
      <image
        class="coupon-left__icon"
        mode="aspectFit"
        :src="typeIconSrc"
      />
      <text class="coupon-left__label">
        {{ typeName || defaultTypeName }}
      </text>
    </view>

    <!-- Perforation divider -->
    <view class="coupon-perforation">
      <view class="coupon-perforation__hole coupon-perforation__hole--top" />
      <view class="coupon-perforation__dash" />
      <view class="coupon-perforation__hole coupon-perforation__hole--bottom" />
    </view>

    <!-- Right: info area -->
    <view class="coupon-right">
      <text class="coupon-right__title">
        {{ title }}
      </text>
      <text
        v-if="description"
        class="coupon-right__desc"
      >
        {{ description }}
      </text>
      <view class="coupon-right__footer">
        <text class="coupon-right__date">
          有效期至 {{ formattedDate }}
        </text>
        <view
          class="coupon-status"
          :class="statusClass"
        >
          <text class="coupon-status__text">
            {{ statusText }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CouponStatus } from '@/types/coupon';

const props = defineProps<{
  typeCode?: string;
  typeName?: string;
  title: string;
  description: string;
  validUntil: string;
  status: CouponStatus;
}>();

defineEmits<{ (event: 'use'): void }>();

/* ---------- status ---------- */
const statusText = computed(() => {
  if (props.status === 'unused') return '未使用';
  if (props.status === 'used') return '已使用';
  return '已过期';
});

const statusClass = computed(() => `coupon-status--${props.status}`);

/* ---------- type theme colors ---------- */
interface ThemeColors {
  gradient: string;
}

const themeMap: Record<string, ThemeColors> = {
  ticket: { gradient: 'linear-gradient(135deg, #7c6fae, #a78bce)' },
  souvenir: { gradient: 'linear-gradient(135deg, #c08b5c, #dbb896)' },
  photo: { gradient: 'linear-gradient(135deg, #6a99b5, #95bfd6)' },
  discount: { gradient: 'linear-gradient(135deg, #6d9e7e, #9cc5a8)' },
};

const defaultTheme: ThemeColors = {
  gradient: 'linear-gradient(135deg, #8a8db8, #b0b3d6)',
};

const resolvedTheme = computed(() => {
  const code = (props.typeCode || '').toLowerCase();
  return themeMap[code] ?? defaultTheme;
});

const themeGradient = computed(() => resolvedTheme.value.gradient);

const defaultTypeName = computed(() => {
  const map: Record<string, string> = {
    ticket: '门票',
    souvenir: '纪念品',
    photo: '照片',
    discount: '折扣',
  };
  return map[(props.typeCode || '').toLowerCase()] ?? '卡券';
});

/* ---------- icon ---------- */
const iconMap: Record<string, string> = {
  ticket: '/static/icons/coupons/ticket.png',
  souvenir: '/static/icons/coupons/souvenir.png',
  photo: '/static/icons/coupons/photo.png',
  discount: '/static/icons/coupons/discount.png',
};

const typeIconSrc = computed(() => {
  const code = (props.typeCode || '').toLowerCase();
  return iconMap[code] ?? '/static/icons/coupons/default.png';
});

/* ---------- date formatting ---------- */
const formattedDate = computed(() => {
  if (!props.validUntil) return '--';
  try {
    const d = new Date(props.validUntil);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  } catch {
    return props.validUntil;
  }
});
</script>

<style scoped lang="scss">
/* ===== Coupon Card — classic voucher style ===== */
$card-radius: 16px;
$left-width: 100px;
$hole-size: 20px;
$page-bg: #f3f6fb;

.coupon-card {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: $card-radius;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(31, 122, 236, 0.1);
  overflow: visible;
  min-height: 110px;
  transition: opacity 0.25s;
}

.coupon-card--inactive {
  opacity: 0.6;
}

/* ---------- Left colored area ---------- */
.coupon-left {
  width: $left-width;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: $card-radius 0 0 $card-radius;
  padding: 16px 8px;
  position: relative;

  &__icon {
    width: 52px;
    height: 52px;
    display: block;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 1px;
  }
}

/* ---------- Perforation divider ---------- */
.coupon-perforation {
  position: relative;
  width: 0;
  flex-shrink: 0;
  z-index: 2;

  &__hole {
    position: absolute;
    left: -($hole-size * 0.5);
    width: $hole-size;
    height: $hole-size;
    border-radius: 50%;
    background: $page-bg;

    &--top {
      top: -($hole-size * 0.5);
    }

    &--bottom {
      bottom: -($hole-size * 0.5);
    }
  }

  &__dash {
    position: absolute;
    top: ($hole-size * 0.5);
    bottom: ($hole-size * 0.5);
    left: 0;
    width: 0;
    border-left: 1.5px dashed #e5e7eb;
  }
}

/* ---------- Right info area ---------- */
.coupon-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 14px 16px 14px 20px;
  min-width: 0;

  &__title {
    display: block;
    font-size: 15px;
    font-weight: 600;
    color: #1a1f2e;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
  }

  &__desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: #5f6b83;
    line-height: 1.5;
    margin-bottom: 10px;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__date {
    font-size: 11px;
    color: #8a94a6;
    flex-shrink: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* ---------- Status badge ---------- */
.coupon-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 10px;
  margin-left: 8px;

  &__text {
    font-size: 11px;
    font-weight: 500;
    line-height: 1.5;
  }
}

.coupon-status--unused {
  background: rgba(5, 150, 105, 0.12);

  .coupon-status__text {
    color: #059669;
  }
}

.coupon-status--used {
  background: rgba(156, 163, 175, 0.15);

  .coupon-status__text {
    color: #9ca3af;
  }
}

.coupon-status--expired {
  background: rgba(239, 68, 68, 0.1);

  .coupon-status__text {
    color: #ef4444;
  }
}
</style>
