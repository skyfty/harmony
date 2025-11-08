<template>
  <view class="page optimize">
    <view class="header">
      <text class="title">优化效果商城</text>
      <text class="subtitle">精选材质与特效，快速升级展厅表现力</text>
    </view>

    <view class="category-tabs">
      <view
        v-for="category in categoryTabs"
        :key="category"
        class="category-tag"
        :class="{ active: category === selectedCategory }"
        @tap="selectCategory(category)"
      >
        {{ category === 'all' ? '全部' : category }}
      </view>
    </view>

    <view v-if="loading" class="loading">
      <text class="loading-text">正在加载商品...</text>
    </view>

    <view class="waterfall" v-else-if="filteredProducts.length">
      <view class="product-card" v-for="product in filteredProducts" :key="product.id" @tap="openDetail(product)">
        <view class="media" :style="product.mediaStyle">
          <view class="purchase-flag" :class="{ owned: product.purchased }">
            {{ product.purchased ? '已购买' : '未购买' }}
          </view>
        </view>
        <view class="info">
          <text class="name">{{ product.name }}</text>
          <text class="desc">{{ product.description }}</text>
        </view>
        <view class="meta">
          <text class="price">¥{{ product.price.toFixed(2) }}</text>
          <text class="category">{{ product.category }}</text>
        </view>
        <button
          class="buy-btn"
          :class="{ disabled: product.purchased }"
          @tap.stop="purchase(product)"
        >
          {{ product.purchased ? '已拥有' : '立即购买' }}
        </button>
      </view>
    </view>

    <view v-else class="empty">
      <view class="empty-icon"></view>
      <text class="empty-title">{{ errorMessage ? '加载失败' : '暂未找到该分类的商品' }}</text>
      <text class="empty-desc">
        {{ errorMessage || '试试切换其他分类或稍后再来看看新品' }}
      </text>
    </view>

    <BottomNav active="optimize" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { apiGetProducts, apiPurchaseProduct, type ProductSummary } from '@/api/miniprogram';
import { redirectToNav, type NavKey } from '@/utils/navKey';

type CategoryKey = 'all' | string;

interface UiProduct extends ProductSummary {
  mediaStyle: Record<string, string>;
}

const fallbackGradients = [
  'linear-gradient(135deg, #74b9ff, #a29bfe)',
  'linear-gradient(135deg, #55efc4, #00cec9)',
  'linear-gradient(135deg, #ffeaa7, #fab1a0)',
  'linear-gradient(135deg, #dfe6e9, #b2bec3)',
];

const products = ref<UiProduct[]>([]);
const selectedCategory = ref<CategoryKey>('all');
const loading = ref(true);
const errorMessage = ref('');

const categoryTabs = computed(() => {
  const set = new Set<string>();
  products.value.forEach((item) => set.add(item.category));
  return ['all', ...Array.from(set)];
});

const filteredProducts = computed(() => {
  if (selectedCategory.value === 'all') {
    return products.value;
  }
  return products.value.filter((item) => item.category === selectedCategory.value);
});

function selectCategory(category: CategoryKey) {
  selectedCategory.value = category;
}

function handleNavigate(target: NavKey) {
  redirectToNav(target, { current: 'optimize' });
}

function createMediaStyle(imageUrl: string | undefined, fallbackIndex: number): Record<string, string> {
  const fallback = fallbackGradients[fallbackIndex % fallbackGradients.length];
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

function normalizeProduct(product: ProductSummary, index: number): UiProduct {
  return {
    ...product,
    mediaStyle: createMediaStyle(product.imageUrl, index),
  };
}

async function fetchProducts(): Promise<void> {
  loading.value = true;
  errorMessage.value = '';
  try {
    const { products: list } = await apiGetProducts();
    products.value = list.map((item, index) => normalizeProduct(item, index));
  } catch (error) {
    const message = error instanceof Error ? error.message : '商品加载失败';
    errorMessage.value = message;
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function updateProductInList(updated: ProductSummary) {
  const index = products.value.findIndex((item) => item.id === updated.id);
  const normalized = normalizeProduct(updated, index >= 0 ? index : products.value.length);
  if (index >= 0) {
    products.value.splice(index, 1, normalized);
  } else {
    products.value.push(normalized);
  }
}

function purchase(product: UiProduct) {
  if (product.purchased) {
    uni.showToast({ title: '您已拥有该商品', icon: 'none' });
    return;
  }
  uni.showModal({
    title: '确认购买',
    content: `确定购买「${product.name}」吗？`,
    confirmColor: '#1f7aec',
    success: async (res) => {
      if (!res.confirm) {
        return;
      }
      uni.showLoading({ title: '下单中...', mask: true });
      try {
        const { order, product: updated } = await apiPurchaseProduct(product.id, {
          paymentMethod: 'wechat',
        });
        updateProductInList(updated);
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

function openDetail(product: UiProduct) {
  uni.navigateTo({ url: `/pages/optimize/detail/index?id=${product.id}` });
}

onShow(() => {
  fetchProducts();
});

onPullDownRefresh(() => {
  fetchProducts();
});
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
  padding: 4px 0 2px;
}

.category-tag {
  padding: 6px 14px;
  border-radius: 14px;
  font-size: 12px;
  color: #4f9eff;
  background: rgba(79, 158, 255, 0.12);
  flex-shrink: 0;
}

.category-tag.active {
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  box-shadow: 0 6px 18px rgba(31, 122, 236, 0.18);
}

.loading {
  margin-top: 60px;
  display: flex;
  justify-content: center;
  color: #8a94a6;
}

.loading-text {
  padding: 10px 18px;
  border-radius: 18px;
  background: rgba(79, 158, 255, 0.12);
  font-size: 13px;
}

.waterfall {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.product-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.09);
  position: relative;
  overflow: hidden;
}

.media {
  height: 140px;
  border-radius: 16px;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.purchase-flag {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 11px;
  color: #ffffff;
  background: rgba(31, 122, 236, 0.65);
  backdrop-filter: blur(6px);
}

.purchase-flag.owned {
  background: rgba(69, 196, 138, 0.78);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.name {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}

.desc {
  font-size: 12px;
  color: #6b778d;
  line-height: 18px;
}

.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8a94a6;
}

.price {
  font-size: 16px;
  font-weight: 600;
  color: #1f7aec;
}

.buy-btn {
  width: 100%;
  padding: 8px 0;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #4f9eff, #1f7aec);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.2);
}

.buy-btn.disabled {
  opacity: 0.7;
  background: rgba(123, 145, 167, 0.35);
  color: #ffffff;
  box-shadow: none;
}

.empty {
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8a94a6;
}

.empty-icon {
  width: 82px;
  height: 82px;
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(79, 158, 255, 0.16), rgba(79, 207, 255, 0.16));
  position: relative;
}

.empty-icon::before {
  content: '';
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 4px solid rgba(79, 158, 255, 0.4);
  left: 50%;
  top: 22px;
  transform: translateX(-50%);
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #4f9eff;
}

.empty-desc {
  font-size: 13px;
  text-align: center;
  line-height: 20px;
}
</style>
