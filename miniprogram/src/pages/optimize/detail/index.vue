<template>
  <view class="page optimize-detail">
    <view v-if="product" class="content">
      <view class="hero" :style="{ background: product.image }">
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
        <button class="outline" @tap="goOrders">查看订单</button>
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
      <text class="empty-desc">返回商城列表重试，或稍后刷新页面</text>
      <button class="outline" @tap="goBack">返回上一页</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { OPTIMIZE_PRODUCTS, type OptimizeProduct } from '@/data/optimizeProducts';

const STORAGE_KEY = 'optimizePurchased';

const productId = ref('');
const product = ref<OptimizeProduct | null>(null);

const defaultTips = [
  '配合展厅灯光预设使用，可获得最佳视觉效果。',
  '下载后可在素材库中查看详细参数并再次编辑。',
  '建议在体验区预览终端中验证加载表现。',
];

const tips = computed(() => defaultTips);

function loadPurchasedIds(): string[] {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('无法读取优化效果购买记录', error);
    return [];
  }
}

function persistPurchasedIds(ids: string[]) {
  try {
    uni.setStorageSync(STORAGE_KEY, ids);
  } catch (error) {
    console.warn('无法保存优化效果购买记录', error);
  }
}

function syncProductState() {
  if (!productId.value) {
    product.value = null;
    return;
  }
  const base = OPTIMIZE_PRODUCTS.find((item) => item.id === productId.value);
  if (!base) {
    product.value = null;
    return;
  }
  const purchasedIds = new Set(loadPurchasedIds());
  product.value = {
    ...base,
    purchased: base.purchased || purchasedIds.has(base.id),
  };
}

onLoad((query) => {
  const rawId = typeof query?.id === 'string' ? query.id : '';
  if (rawId) {
    productId.value = rawId;
  }
  syncProductState();
});

onShow(() => {
  syncProductState();
});

function markAsPurchased() {
  if (!product.value) {
    return;
  }
  const ids = new Set(loadPurchasedIds());
  ids.add(product.value.id);
  persistPurchasedIds(Array.from(ids));
  syncProductState();
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
    success: (res) => {
      if (!res.confirm || !product.value) {
        return;
      }
      markAsPurchased();
      const orderId = `OP${Date.now()}`;
      const itemsPayload = encodeURIComponent(
        JSON.stringify([
          {
            name: product.value.name,
            price: product.value.price,
            category: product.value.category,
          },
        ]),
      );
      const payment = encodeURIComponent('微信支付');
      const address = encodeURIComponent('上海市黄浦区外滩18号 数字艺廊中心');
      const createdAt = encodeURIComponent(new Date().toISOString());
      const total = product.value.price.toFixed(2);

      uni.showToast({ title: '购买成功', icon: 'success', duration: 500 });

      setTimeout(() => {
        uni.navigateTo({
          url: `/pages/orders/detail/index?id=${orderId}&status=processing&items=${itemsPayload}&total=${total}&payment=${payment}&address=${address}&createdAt=${createdAt}`,
        });
      }, 400);
    },
  });
}

function goOrders() {
  uni.navigateTo({ url: '/pages/orders/index' });
}

function goBack() {
  uni.navigateBack({ delta: 1 });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 40px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
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
  bottom: 24px;
}

.primary,
.outline {
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

.outline {
  border: 1px solid rgba(79, 158, 255, 0.4);
  background: transparent;
  color: #1f7aec;
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
