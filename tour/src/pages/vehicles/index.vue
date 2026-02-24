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
        @tap="select(vehicle.id, vehicle.status)"
      />
    </view>
    <BottomNav
      active="vehicle"
      @navigate="handleNavigate"
    />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
defineOptions({ name: 'VehiclesPage' });

const statusBarHeight = ref(0);
try {
  const sysInfo = uni.getSystemInfoSync();
  statusBarHeight.value = sysInfo?.statusBarHeight ?? 0;
} catch { /* fallback */ }
import BottomNav from '@/components/BottomNav.vue';
import PageHeader from '@/components/PageHeader.vue';
import VehicleCard from '@/components/VehicleCard.vue';
import { listVehicles, purchaseVehicleByProduct, selectCurrentVehicle } from '@/api/mini/vehicles';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleStatus } from '@/types/vehicle';
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

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
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
const purchaseVehicle = purchaseVehicleByProduct as unknown as (productId: string) => Promise<unknown>;
const selectVehicleAsCurrent =
  selectCurrentVehicle as unknown as (vehicleId: string) => Promise<{ currentVehicleId: string }>;

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

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

async function select(id: string, status: VehicleStatus) {
  if (loading.value) {
    return;
  }
  const selectedVehicle: Vehicle | null = vehicles.value.find((item) => item.id === id) || null;
  if (!selectedVehicle) {
    return;
  }
  if (status === 'locked') {
    const confirmed = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '购买车辆',
        content: `是否购买「${selectedVehicle.name}」？`,
        confirmText: '确认',
        cancelText: '取消',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) {
      return;
    }
    const productId: string = String((selectedVehicle as { productId?: unknown }).productId ?? '');
    if (!productId) {
      void uni.showToast({ title: '该车辆暂不可购买', icon: 'none' });
      return;
    }
    loading.value = true;
    void uni.showLoading({ title: '购买中...' });
    try {
      await purchaseVehicle(productId);
      await reload();
      void uni.showToast({ title: '购买成功', icon: 'none' });
    } catch (error: unknown) {
      void uni.showToast({ title: toErrorMessage(error, '购买失败'), icon: 'none' });
    } finally {
      loading.value = false;
      void uni.hideLoading();
    }
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
    void uni.showToast({ title: toErrorMessage(error, '设置失败'), icon: 'none' });
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
  padding: 0 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
