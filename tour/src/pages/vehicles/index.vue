<template>
  <view class="page">
    <PageHeader
      title="代步工具"
      :show-back="false"
    />
    <view class="content">
      <VehicleCard
        v-for="vehicle in vehicles"
        :key="vehicle.id"
        :name="vehicle.name"
        :summary="vehicle.summary"
        :cover-url="vehicle.coverUrl"
        :status="vehicle.status"
        :selected="vehicle.id === selectedId"
        :max-speed="vehicle.maxSpeed"
        :acceleration="vehicle.acceleration"
        :braking="vehicle.braking"
        :handling="vehicle.handling"
        :mass="vehicle.mass"
        :drag="vehicle.drag"
        @tap="select(vehicle.id, vehicle.status)"
      />
    </view>
    <BottomNav
      active="vehicle"
      @navigate="handleNavigate"
    />
    <view v-if="showPurchaseConfirmDialog" class="purchase-dialog">
      <view class="purchase-dialog__mask" @tap="closePurchaseConfirmDialog" />
      <view class="purchase-dialog__panel">
        <view class="purchase-dialog__title">购买车辆</view>
        <view class="purchase-dialog__content">是否购买「{{ purchaseConfirmVehicleName }}」？</view>
        <view class="purchase-dialog__actions">
          <button class="purchase-dialog__btn purchase-dialog__btn--cancel" :disabled="loading" @tap="closePurchaseConfirmDialog">
            取消
          </button>
          <button class="purchase-dialog__btn purchase-dialog__btn--confirm" :disabled="loading" @tap="confirmPurchaseFromDialog">
            确认
          </button>
        </view>
      </view>
    </view>
    <PhoneBindSheet v-model="showPhoneBindSheet" @bound="handlePhoneBound" />
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { onMounted, ref } from 'vue';
import { getStatusBarHeight } from '@/utils/systemInfo';
defineOptions({ name: 'VehiclesPage' });

const statusBarHeight = ref(getStatusBarHeight());
import BottomNav from '@/components/BottomNav.vue';
import PageHeader from '@/components/PageHeader.vue';
import PhoneBindSheet from '@/components/PhoneBindSheet.vue';
import VehicleCard from '@/components/VehicleCard.vue';
import { listVehicles, purchaseVehicleByProduct, selectCurrentVehicle } from '@/api/mini/vehicles';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleStatus } from '@/types/vehicle';
import {
  isProfileCompletionRequiredError,
  isPhoneBindingRequiredError,
  promptCompleteProfileBeforeCheckout,
  requestMiniProgramPayment,
  toCheckoutErrorMessage,
} from '@/utils/checkout';
import { redirectToNav, type NavKey } from '@/utils/navKey';

const VEHICLE_SELECTION_STORAGE_KEY = 'tour:selectedVehicleId';
const VEHICLE_SELECTION_OBJECT_STORAGE_KEY = 'tour:selectedVehicle';

function getSelectedVehicleId(): string | null {
  try {
    const value: unknown = uni.getStorageSync(VEHICLE_SELECTION_STORAGE_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

function setSelectedVehicleId(id: string | null): void {
  try {
    if (id) {
      uni.setStorageSync(VEHICLE_SELECTION_STORAGE_KEY, id);
    } else {
      uni.removeStorageSync(VEHICLE_SELECTION_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function setSelectedVehicle(vehicle: Vehicle | null): void {
  try {
    if (vehicle) {
      uni.setStorageSync(VEHICLE_SELECTION_OBJECT_STORAGE_KEY, JSON.stringify(vehicle));
    } else {
      uni.removeStorageSync(VEHICLE_SELECTION_OBJECT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

const vehicles = ref<Vehicle[]>([]);
const selectedId = ref(getSelectedVehicleId());
const loading = ref(false);
const showPhoneBindSheet = ref(false);
const pendingPurchaseProductId = ref<string>('');
const showPurchaseConfirmDialog = ref(false);
const purchaseConfirmVehicleId = ref<string>('');
const purchaseConfirmVehicleName = ref('');
const purchaseVehicle = purchaseVehicleByProduct as unknown as (productId: string) => Promise<unknown>;
const selectVehicleAsCurrent =
  selectCurrentVehicle as unknown as (vehicleId: string) => Promise<{ currentVehicleId: string }>;

function closePurchaseConfirmDialog() {
  showPurchaseConfirmDialog.value = false;
  purchaseConfirmVehicleId.value = '';
  purchaseConfirmVehicleName.value = '';
}

async function confirmPurchaseFromDialog() {
  const vehicleId = purchaseConfirmVehicleId.value;
  const selectedVehicle: Vehicle | null = vehicles.value.find((item) => item.id === vehicleId) || null;
  closePurchaseConfirmDialog();
  if (!selectedVehicle) {
    return;
  }
  const productId: string = String((selectedVehicle as { productId?: unknown }).productId ?? '');
  if (!productId) {
    void uni.showToast({ title: '该车辆暂不可购买', icon: 'none' });
    return;
  }
  pendingPurchaseProductId.value = productId;
  await purchaseVehicleWithProductId(productId);
}

async function reload() {
  const rows = (await listVehicles()) as unknown as Vehicle[];
  vehicles.value = rows;
  const current = rows.find((item) => item.isCurrent);
  if (current) {
    selectedId.value = current.id;
    setSelectedVehicleId(current.id);
    setSelectedVehicle(current);
  }
}

function hasOwnedVehicleByProductId(productId: string): boolean {
  if (!productId) {
    return false;
  }
  return vehicles.value.some((item) => item.productId === productId && item.status === 'owned');
}

async function waitForVehicleOwnershipSync(productId: string): Promise<boolean> {
  if (!productId) {
    await reload();
    return false;
  }

  const maxAttempts = 8;
  const intervalMs = 700;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await reload();
    if (hasOwnedVehicleByProductId(productId)) {
      return true;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), intervalMs);
      });
    }
  }
  return false;
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

onShow(() => {
  void reload().catch(() => {
    // Keep silent on foreground refresh failure to avoid noisy toasts.
  });
});

async function purchaseVehicleWithProductId(productId: string) {
  if (!productId || loading.value) {
    return;
  }

  loading.value = true;
  void uni.showLoading({ title: '购买中...' });
  try {
    const result = (await purchaseVehicle(productId)) as {
      order?: { id: string };
      payParams?: {
        appId: string;
        timeStamp: string;
        nonceStr: string;
        package: string;
        signType: 'RSA';
        paySign: string;
      };
    };
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams);
    }
    const synced = await waitForVehicleOwnershipSync(productId);
    void uni.showToast({ title: synced ? '购买成功' : '支付成功，状态同步中', icon: 'none' });
    if (result.order?.id) {
      uni.navigateTo({ url: `/pages/orders/detail/index?id=${encodeURIComponent(result.order.id)}` });
    }
  } catch (error: unknown) {
    if (isPhoneBindingRequiredError(error)) {
      closePurchaseConfirmDialog();
      pendingPurchaseProductId.value = productId;
      showPhoneBindSheet.value = true;
      return;
    }
    if (isProfileCompletionRequiredError(error)) {
      closePurchaseConfirmDialog();
      await promptCompleteProfileBeforeCheckout();
      return;
    }
    void uni.showToast({ title: toCheckoutErrorMessage(error, '购买失败'), icon: 'none' });
  } finally {
    loading.value = false;
    void uni.hideLoading();
  }
}

async function handlePhoneBound() {
  const productId = pendingPurchaseProductId.value;
  pendingPurchaseProductId.value = '';
  if (!productId) {
    return;
  }
  await purchaseVehicleWithProductId(productId);
}

async function select(id: string, status: VehicleStatus) {
  if (loading.value) {
    return;
  }
  const selectedVehicle: Vehicle | null = vehicles.value.find((item) => item.id === id) || null;
  if (!selectedVehicle) {
    return;
  }
  if (status === 'locked') {
    purchaseConfirmVehicleId.value = selectedVehicle.id;
    purchaseConfirmVehicleName.value = selectedVehicle.name;
    showPurchaseConfirmDialog.value = true;
    return;
  }

  loading.value = true;
  void uni.showLoading({ title: '设置中...' });
  try {
    await selectVehicleAsCurrent(id);
    await reload();
    const latestVehicle = vehicles.value.find((item) => item.id === id) || selectedVehicle;
    selectedId.value = id;
    setSelectedVehicleId(id);
    setSelectedVehicle(latestVehicle);
    void uni.showToast({ title: '已设为当前车辆', icon: 'none' });
  } catch (error: unknown) {
    void uni.showToast({ title: toCheckoutErrorMessage(error, '设置失败'), icon: 'none' });
  } finally {
    loading.value = false;
    void uni.hideLoading();
  }
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f6fb;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.header {
  padding: 8px 16px 12px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: #171f37;
  text-align: center;
  margin-bottom: 14px;
}

.search-box {
  background: #e6ebf3;
  border-radius: 999px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  font-size: 14px;
  color: #94a0b6;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1b2438;
}

.clear-icon {
  font-size: 14px;
  color: #8f99ac;
}

.content {
  padding: 12px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.purchase-dialog {
  position: fixed;
  inset: 0;
  z-index: 1200;
}

.purchase-dialog__mask {
  position: absolute;
  inset: 0;
  background: rgba(8, 12, 20, 0.48);
}

.purchase-dialog__panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 620rpx;
  max-width: calc(100vw - 64rpx);
  border-radius: 28rpx;
  background: #ffffff;
  padding: 36rpx 30rpx 26rpx;
  box-shadow: 0 22rpx 70rpx rgba(24, 35, 66, 0.2);
}

.purchase-dialog__title {
  font-size: 34rpx;
  line-height: 48rpx;
  font-weight: 700;
  color: #101828;
  text-align: center;
}

.purchase-dialog__content {
  margin-top: 16rpx;
  font-size: 28rpx;
  line-height: 42rpx;
  color: #344054;
  text-align: center;
}

.purchase-dialog__actions {
  margin-top: 30rpx;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
}

.purchase-dialog__btn {
  height: 78rpx;
  line-height: 78rpx;
  border-radius: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.purchase-dialog__btn::after {
  border: 0;
}

.purchase-dialog__btn--cancel {
  background: #eef2f8;
  color: #344054;
}

.purchase-dialog__btn--confirm {
  background: #2e6eff;
  color: #ffffff;
}
</style>
