<template>
  <view class="page optimize-detail">
    <view v-if="loading" class="loading">
      <text class="loading-text">正在加载商品...</text>
    </view>

    <view v-else-if="product" class="content">
      <view class="hero" :style="heroStyle">
        <view class="purchase-flag" :class="{ owned: product.purchased }">
          {{ product.purchased ? '已购买' : '未购买' }}
        </view>
      </view>

      <view class="card basic">
        <text class="title">{{ product.name }}</text>
        <view class="row">
          <text class="label">分类</text>
          <text class="value">{{ product.category }}</text>
        </view>
        <view class="row">
          <text class="label">价格</text>
          <text class="price">¥{{ product.price.toFixed(2) }}</text>
        </view>
        <text class="description">{{ product.description }}</text>
      </view>

      <view class="card suggestions">
        <text class="card-title">使用建议</text>
        <view class="bullet" v-for="tip in tips" :key="tip">
          <view class="dot"></view>
          <text class="tip-text">{{ tip }}</text>
        </view>
      </view>

      <view class="footer">
        <button class="secondary" @tap="goOrders">查看订单</button>
        <button
          class="primary"
          :class="{ disabled: product.purchased }"
          @tap="purchase"
        >
          {{ product.purchased ? '已拥有' : '立即购买' }}
        </button>
      </view>
    </view>

    <view v-else class="empty">
      <text class="empty-title">未找到商品</text>
      <text class="empty-desc">{{ errorMessage || '返回商城列表重试，或稍后刷新页面' }}</text>
      <button class="outline" @tap="goBack">返回上一页</button>
    </view>

    <BottomNav active="optimize" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { apiGetProduct, apiPurchaseProduct, type ProductSummary, type ProductUsageConfig } from '@/api/miniprogram';

const productId = ref('');
const product = ref<ProductSummary | null>(null);
const loading = ref(true);
const errorMessage = ref('');

const fallbackGradients = [
  'linear-gradient(135deg, #74b9ff, #a29bfe)',
  'linear-gradient(135deg, #55efc4, #00cec9)',
  'linear-gradient(135deg, #ffeaa7, #fab1a0)',
  'linear-gradient(135deg, #dfe6e9, #b2bec3)',
];

const defaultTips = [
  '配合展厅灯光预设使用，可获得最佳视觉效果。',
  '下载后可在素材库中查看详细参数并再次编辑。',
  '建议在体验区预览终端中验证加载表现。',
];

function computeFallbackIndex(key?: string): number {
  if (!key) {
    return 0;
  }
  return Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function resolveHeroStyle(imageUrl?: string, key?: string): Record<string, string> {
  const index = computeFallbackIndex(key);
  const fallback = fallbackGradients[index % fallbackGradients.length];
  if (!imageUrl) {
    return { background: fallback };
  }
  if (imageUrl.startsWith('linear-gradient')) {
    return { background: imageUrl };
  }
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

const heroStyle = computed(() => resolveHeroStyle(product.value?.imageUrl, product.value?.id ?? productId.value));

function buildUsageTips(usage?: ProductUsageConfig): string[] {
  if (!usage) {
    return [];
  }
  const result: string[] = [];
  if (usage.type === 'consumable') {
    result.push('启用后会消耗库存次数，请提前规划展览使用。');
  } else {
    result.push('购买后可在多个展览中重复使用，无需额外次数。');
  }
  if (usage.perExhibitionLimit && usage.perExhibitionLimit > 0) {
    if (usage.perExhibitionLimit === 1) {
      result.push('每场展览仅可启用一次。');
    } else {
      result.push(`每场展览最多可启用 ${usage.perExhibitionLimit} 次。`);
    }
  }
  if (usage.exclusiveGroup) {
    result.push('该商品与同类优化包互斥，同一展览仅能选择其中一种。');
  }
  if (usage.stackable) {
    result.push('支持叠加购买，库存数量可累积。');
  }
  if (usage.notes) {
    result.push(usage.notes);
  }
  return result;
}

const tips = computed(() => {
  const merged = [...buildUsageTips(product.value?.usageConfig), ...defaultTips];
  const unique: string[] = [];
  const seen = new Set<string>();
  merged.forEach((tip) => {
    if (!seen.has(tip)) {
      seen.add(tip);
      unique.push(tip);
    }
  });
  return unique;
});

async function loadProduct(id: string): Promise<void> {
  if (!id) {
    loading.value = false;
    product.value = null;
    errorMessage.value = '缺少商品编号';
    uni.stopPullDownRefresh();
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  try {
    product.value = await apiGetProduct(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未能加载商品';
    errorMessage.value = message;
    product.value = null;
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function purchase() {
  if (!product.value) {
    return;
  }
  if (product.value.purchased) {
    uni.showToast({ title: '您已拥有该商品', icon: 'none' });
    return;
  }
  uni.showModal({
    title: '确认购买',
    content: `确定购买「${product.value.name}」吗？`,
    confirmColor: '#1f7aec',
    success: async (res) => {
      if (!res.confirm || !product.value) {
        return;
      }
      uni.showLoading({ title: '下单中...', mask: true });
      try {
        const { order, product: updated } = await apiPurchaseProduct(product.value.id, {
          paymentMethod: 'wechat',
        });
        product.value = { ...product.value, ...updated };
        uni.showToast({ title: '购买成功', icon: 'success', duration: 600 });

        setTimeout(() => {
          uni.navigateTo({ url: `/pages/orders/detail/index?id=${order.id}` });
        }, 400);
      } catch (error) {
        const message = error instanceof Error ? error.message : '购买失败，请稍后重试';
        uni.showToast({ title: message, icon: 'none' });
      } finally {
        uni.hideLoading();
      }
    },
  });
}

function goOrders() {
  uni.navigateTo({ url: '/pages/orders/index' });
}

function goBack() {
  uni.navigateBack({ delta: 1 });
}

function handleNavigate(target: NavKey) {
  redirectToNav(target, { current: 'optimize' });
}

onLoad((query) => {
  const rawId = typeof query?.id === 'string' ? query.id : '';
  productId.value = rawId;
  if (rawId) {
    loadProduct(rawId);
  } else {
    loading.value = false;
    product.value = null;
    errorMessage.value = '缺少商品编号';
  }
});

onPullDownRefresh(() => {
  loadProduct(productId.value);
});
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 120px;
  padding-top: 84px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
}

.loading {
  margin-top: 80px;
  display: flex;
  justify-content: center;
  color: #8a94a6;
}

.loading-text {
  padding: 12px 22px;
  border-radius: 22px;
  background: rgba(79, 158, 255, 0.12);
  font-size: 13px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero {
  height: 220px;
  border-radius: 24px;
  position: relative;
  box-shadow: 0 18px 40px rgba(31, 122, 236, 0.2);
}

.purchase-flag {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 6px 14px;
  border-radius: 50px;
  font-size: 12px;
  color: #ffffff;
  background: rgba(31, 122, 236, 0.7);
  backdrop-filter: blur(6px);
}

.purchase-flag.owned {
  background: rgba(69, 196, 138, 0.82);
}

.card {
  background: #ffffff;
  border-radius: 22px;
  padding: 20px;
  box-shadow: 0 16px 36px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.basic .title {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #6b778d;
}

.label {
  color: #8a94a6;
}

.value {
  color: #1f1f1f;
}

.price {
  font-size: 20px;
  font-weight: 700;
  color: #1f7aec;
}

.description {
  font-size: 13px;
  color: #5f6b83;
  line-height: 20px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.bullet {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  margin-top: 6px;
}

.tip-text {
  font-size: 13px;
  color: #6b778d;
  line-height: 20px;
}

.footer {
  display: flex;
  gap: 12px;
  position: sticky;
  bottom: 96px;
}

.primary,
.secondary {
  flex: 1;
  padding: 14px 0;
  border-radius: 18px;
  border: none;
  font-size: 15px;
  font-weight: 600;
}

.primary {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.2);
}

.primary.disabled {
  background: rgba(123, 145, 167, 0.35);
  box-shadow: none;
}

.secondary {
  background: linear-gradient(135deg, rgba(79, 158, 255, 0.18), rgba(79, 207, 255, 0.28));
  color: #1f3c7a;
  box-shadow: 0 10px 22px rgba(79, 158, 255, 0.18);
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #8a94a6;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.empty-desc {
  font-size: 13px;
  text-align: center;
  line-height: 20px;
}
</style>
