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

    <view class="waterfall" v-if="filteredProducts.length">
      <view class="product-card" v-for="product in filteredProducts" :key="product.id" @tap="openDetail(product)">
        <view class="media" :style="{ background: product.image }">
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
      <text class="empty-title">暂未找到该分类的商品</text>
      <text class="empty-desc">试试切换其他分类或稍后再来看看新品</text>
    </view>

    <BottomNav active="optimize" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { OPTIMIZE_PRODUCTS, type OptimizeProduct } from '@/data/optimizeProducts';

type NavKey = 'home' | 'work' | 'exhibition' | 'profile' | 'optimize';
type CategoryKey = 'all' | string;

const STORAGE_KEY = 'optimizePurchased';

const products = ref<OptimizeProduct[]>(OPTIMIZE_PRODUCTS.map((item) => ({ ...item })));
const selectedCategory = ref<CategoryKey>('all');

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

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  work: '/pages/works/indite',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  optimize: '/pages/optimize/index',
};

function selectCategory(category: CategoryKey) {
  selectedCategory.value = category;
}

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route || target === 'optimize') {
    return;
  }
  uni.redirectTo({ url: route });
}

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

function syncPurchasedState() {
  const purchasedIds = new Set(loadPurchasedIds());
  products.value = OPTIMIZE_PRODUCTS.map((item) => ({
    ...item,
    purchased: item.purchased || purchasedIds.has(item.id),
  }));
}

onShow(() => {
  syncPurchasedState();
});

function markAsPurchased(productId: string) {
  const ids = new Set(loadPurchasedIds());
  ids.add(productId);
  persistPurchasedIds(Array.from(ids));
  syncPurchasedState();
}

function purchase(product: OptimizeProduct) {
  if (product.purchased) {
    uni.showToast({ title: '您已拥有该商品', icon: 'none' });
    return;
  }
  uni.showModal({
    title: '确认购买',
    content: `确定购买「${product.name}」吗？`,
    confirmColor: '#1f7aec',
    success: (res) => {
      if (!res.confirm) {
        return;
      }
      markAsPurchased(product.id);
      const orderId = `OP${Date.now()}`;
      const itemsPayload = encodeURIComponent(
        JSON.stringify([
          {
            name: product.name,
            price: product.price,
            category: product.category,
          },
        ]),
      );
      const payment = encodeURIComponent('微信支付');
      const address = encodeURIComponent('上海市黄浦区外滩18号 数字艺廊中心');
      const createdAt = encodeURIComponent(new Date().toISOString());
      const total = product.price.toFixed(2);

      uni.showToast({ title: '购买成功', icon: 'success', duration: 500 });

      setTimeout(() => {
        uni.navigateTo({
          url: `/pages/orders/detail/index?id=${orderId}&status=processing&items=${itemsPayload}&total=${total}&payment=${payment}&address=${address}&createdAt=${createdAt}`,
        });
      }, 400);
    },
  });
}

function openDetail(product: OptimizeProduct) {
  uni.navigateTo({ url: `/pages/optimize/detail/index?id=${product.id}` });
}
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
