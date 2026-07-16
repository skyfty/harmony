<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="商品中心" :show-back="false" />

    <view class="hero">
      <text class="hero__title">统一购买与使用中心</text>
      <text class="hero__desc">车辆、人物、船舶、飞行器等都在这里购买，购买后可按类型单独设置使用中状态。</text>
    </view>

    <view class="toolbar">
      <input
        v-model="keyword"
        class="search"
        placeholder="搜索商品名称或编号"
        confirm-type="search"
      />

      <scroll-view scroll-x class="categories" show-scrollbar="false">
        <text
          v-for="item in categoryChips"
          :key="item.value || 'all'"
          class="category"
          :class="{ active: selectedCategoryId === item.value }"
          @tap="selectedCategoryId = item.value"
        >
          {{ item.label }}
        </text>
      </scroll-view>

      <view class="filters">
        <view class="filter-pill" :class="{ active: ownedOnly }" @tap="ownedOnly = !ownedOnly">
          {{ ownedOnly ? '显示全部商品' : '只看已购商品' }}
        </view>
        <view class="filter-pill filter-pill--ghost" @tap="reload">
          刷新
        </view>
      </view>
    </view>

    <view class="content">
      <view v-for="product in visibleProducts" :key="product.id" class="card" @tap="handleCardTap(product)">
        <image class="cover" :src="product.coverUrl || fallbackCover" mode="aspectFill" />
        <view class="main">
          <view class="title-row">
            <text class="name">{{ product.name }}</text>
            <text class="badge" :class="statusClass(product)">{{ statusText(product) }}</text>
          </view>

          <view class="meta-row">
            <text class="category-tag">{{ categoryName(product.categoryId) }}</text>
            <text class="price">¥{{ formatPrice(product.price) }}</text>
          </view>

          <text v-if="product.description" class="description">{{ product.description }}</text>

          <view v-if="product.controllableAsset" class="asset-row">
            <text class="asset-type">{{ controllableLabel(product.controllableAsset.type) }}</text>
            <text class="asset-id">编号 {{ product.controllableAsset.identifier }}</text>
          </view>

          <view class="actions">
            <button
              class="action-btn"
              :class="actionButtonClass(product)"
              :disabled="loading || actionDisabled(product)"
              @tap.stop="handlePrimaryAction(product)"
            >
              {{ actionButtonLabel(product) }}
            </button>
          </view>
        </view>
      </view>

      <view v-if="!loading && !visibleProducts.length" class="empty">
        暂无匹配商品
      </view>
    </view>

    <BottomNav active="products" @navigate="handleNavigate" />
    <PhoneBindSheet v-model="showPhoneBindSheet" @bound="handlePhoneBound" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import BottomNav from '@/components/BottomNav.vue'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'
import PageHeader from '@/components/PageHeader.vue'
import PhoneBindSheet from '@/components/PhoneBindSheet.vue'
import {
  listProductCategories,
  listProducts,
  purchaseProductById,
  resolveControllableLabel,
  type ProductCategoryItem,
  type ProductListItem,
} from '@/api/mini/products'
import { selectControllableAsset } from '@/api/mini/controllableAssets'
import { ensureMiniCapability } from '@/platform/runtime'
import { redirectToNav, type NavKey } from '@/utils/navKey'
import { setSelectedControllable } from '@/utils/controllableSelection'
import { isPhoneBindingRequiredError, requestMiniProgramPayment, toCheckoutErrorMessage } from '@/utils/checkout'
import type { MiniPaymentAction } from '@mini-platform/core'

const fallbackCover = '/static/images/checkin.jpg'
const controllableLabel = resolveControllableLabel

const keyword = ref('')
const selectedCategoryId = ref('')
const ownedOnly = ref(false)
const loading = ref(false)
const paymentEnabled = ref(false)
const showPhoneBindSheet = ref(false)
const pendingProductId = ref('')
const categories = ref<ProductCategoryItem[]>([])
const products = ref<ProductListItem[]>([])

const categoryChips = computed(() => [
  { value: '', label: '全部' },
  ...categories.value
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      value: item.id,
      label: item.name,
    })),
])

const visibleProducts = computed(() => {
  return products.value.filter((item) => !ownedOnly.value || item.purchased)
})

function categoryName(categoryId: string | null | undefined): string {
  if (!categoryId) {
    return '未分类'
  }
  return categories.value.find((item) => item.id === categoryId)?.name || '未分类'
}

function formatPrice(price: number): string {
  const value = Number.isFinite(Number(price)) ? Number(price) : 0
  return value.toFixed(2).replace(/\.00$/, '')
}

function statusText(product: ProductListItem): string {
  if (!product.purchased) {
    return '可购买'
  }
  if (product.controllableAsset?.selected) {
    return '使用中'
  }
  if (product.state === 'expired') {
    return '已过期'
  }
  if (product.state === 'used') {
    return '已使用'
  }
  return '已拥有'
}

function statusClass(product: ProductListItem): string {
  if (!product.purchased) {
    return 'badge--buy'
  }
  if (product.controllableAsset?.selected) {
    return 'badge--active'
  }
  return 'badge--owned'
}

function actionButtonLabel(product: ProductListItem): string {
  if (!product.purchased) {
    return '购买'
  }
  if (product.controllableAsset?.selected) {
    return '使用中'
  }
  if (product.controllableAsset) {
    return '设为使用'
  }
  return '已拥有'
}

function actionButtonClass(product: ProductListItem): string {
  if (!product.purchased) {
    return 'action-btn--primary'
  }
  if (product.controllableAsset?.selected) {
    return 'action-btn--success'
  }
  if (product.controllableAsset) {
    return 'action-btn--secondary'
  }
  return 'action-btn--disabled'
}

function actionDisabled(product: ProductListItem): boolean {
  return Boolean(product.purchased && !product.controllableAsset)
}

async function reload() {
  loading.value = true
  try {
    const [categoryRows, productRows] = await Promise.all([
      listProductCategories(),
      listProducts({
        keyword: keyword.value.trim() || undefined,
        categoryId: selectedCategoryId.value || undefined,
      }),
    ])
    categories.value = categoryRows
    products.value = productRows
  } finally {
    loading.value = false
  }
}

watch([keyword, selectedCategoryId], () => {
  void reload()
})

onMounted(() => {
  void reload()
})

onShow(() => {
  void ensureMiniCapability('payment')
    .then((enabled) => {
      paymentEnabled.value = enabled
    })
    .catch(() => {
      paymentEnabled.value = false
    })
  void reload()
})

async function handleCardTap(product: ProductListItem) {
  if (!product.purchased) {
    await handlePurchase(product)
    return
  }
  if (product.controllableAsset && !product.controllableAsset.selected) {
    await handleUse(product)
  }
}

async function handlePrimaryAction(product: ProductListItem) {
  if (!product.purchased) {
    await handlePurchase(product)
    return
  }
  if (product.controllableAsset && !product.controllableAsset.selected) {
    await handleUse(product)
    return
  }
  void uni.showToast({ title: '当前已经在使用中', icon: 'none' })
}

async function handlePurchase(product: ProductListItem) {
  if (!paymentEnabled.value) {
    void uni.showToast({ title: '当前平台暂未开放购买', icon: 'none' })
    return
  }
  if (loading.value) {
    return
  }

  loading.value = true
  void uni.showLoading({ title: '购买中...' })
  try {
    const result = await purchaseProductById(product.id)
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams as MiniPaymentAction)
    }
    await reload()
    void uni.showToast({ title: '购买成功', icon: 'none' })
    if (result.order?.id) {
      uni.navigateTo({ url: `/pages/orders/detail/index?id=${encodeURIComponent(result.order.id)}` })
    }
  } catch (error: unknown) {
    if (isPhoneBindingRequiredError(error)) {
      pendingProductId.value = product.id
      showPhoneBindSheet.value = true
      return
    }
    void uni.showToast({ title: toCheckoutErrorMessage(error, '购买失败'), icon: 'none' })
  } finally {
    loading.value = false
    void uni.hideLoading()
  }
}

async function handleUse(product: ProductListItem) {
  const controllableAsset = product.controllableAsset
  if (!controllableAsset || loading.value) {
    return
  }

  loading.value = true
  void uni.showLoading({ title: '设置中...' })
  try {
    await selectControllableAsset(controllableAsset.id)
    setSelectedControllable(controllableAsset.type, {
      id: controllableAsset.id,
      identifier: controllableAsset.identifier,
      name: controllableAsset.name,
      type: controllableAsset.type,
      prefabUrl: controllableAsset.prefabUrl ?? '',
    })
    await reload()
    void uni.showToast({ title: `${resolveControllableLabel(controllableAsset.type)}已设为使用中`, icon: 'none' })
  } catch (error: unknown) {
    void uni.showToast({ title: toCheckoutErrorMessage(error, '设置失败'), icon: 'none' })
  } finally {
    loading.value = false
    void uni.hideLoading()
  }
}

async function handlePhoneBound() {
  const productId = pendingProductId.value
  pendingProductId.value = ''
  if (!productId) {
    return
  }
  const product = products.value.find((item) => item.id === productId)
  if (product) {
    await handlePurchase(product)
  }
}

function handleNavigate(key: NavKey) {
  redirectToNav(key)
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding-bottom: 90px;
  background:
    radial-gradient(circle at top left, rgba(31, 122, 236, 0.14), transparent 30%),
    linear-gradient(180deg, #f6f8fc 0%, #eef3fb 100%);
}

.hero {
  margin: 0 16px 12px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 28px rgba(31, 47, 77, 0.08);
}

.hero__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #172033;
}

.hero__desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #5b657a;
}

.toolbar {
  padding: 0 16px 8px;
}

.search {
  box-sizing: border-box;
  width: 100%;
  height: 42px;
  padding: 0 14px;
  border-radius: 22px;
  background: #ffffff;
  box-shadow: 0 8px 20px rgba(31, 47, 77, 0.06);
}

.categories {
  display: block;
  margin-top: 12px;
  white-space: nowrap;
}

.category {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #ffffff;
  color: #596579;
  font-size: 12px;
}

.category.active {
  color: #1f7aec;
  background: #eaf2ff;
  font-weight: 600;
}

.filters {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.filter-pill {
  height: 32px;
  line-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: #ffffff;
  color: #596579;
  font-size: 12px;
}

.filter-pill.active {
  color: #1f7aec;
  background: #eaf2ff;
}

.filter-pill--ghost {
  color: #344054;
}

.content {
  padding: 6px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(31, 47, 77, 0.08);
}

.cover {
  width: 96px;
  height: 96px;
  border-radius: 12px;
  background: #edf1f7;
  flex-shrink: 0;
}

.main {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 700;
  color: #172033;
}

.badge {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
}

.badge--buy {
  color: #b42318;
  background: #fef3f2;
}

.badge--owned {
  color: #175cd3;
  background: #eff4ff;
}

.badge--active {
  color: #027a48;
  background: #ecfdf3;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.category-tag {
  font-size: 12px;
  color: #475467;
}

.price {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}

.description {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #667085;
}

.asset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.asset-type,
.asset-id {
  font-size: 11px;
  color: #1f7aec;
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 999px;
}

.asset-id {
  color: #475467;
  background: #f2f4f7;
}

.actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.action-btn {
  min-width: 124px;
  height: 36px;
  line-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.action-btn::after {
  border: 0;
}

.action-btn--primary {
  background: linear-gradient(135deg, #2d7ff9, #1f5bd6);
  color: #ffffff;
}

.action-btn--secondary {
  background: #eff6ff;
  color: #175cd3;
}

.action-btn--success {
  background: #ecfdf3;
  color: #027a48;
}

.action-btn--disabled {
  background: #f2f4f7;
  color: #98a2b3;
}

.empty {
  padding: 48px 0;
  text-align: center;
  color: #98a2b3;
}
</style>
