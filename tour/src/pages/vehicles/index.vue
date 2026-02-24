<template>
  <view class="page">
    <PageHeader title="代步工具" :showBack="false" />
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
    <BottomNav active="vehicle" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

const statusBarHeight = ref(0);
try {
  const sysInfo = uni.getSystemInfoSync();
  statusBarHeight.value = sysInfo?.statusBarHeight ?? 0;
} catch { /* fallback */ }
import BottomNav from '@/components/BottomNav.vue';
import PageHeader from '@/components/PageHeader.vue';
import VehicleCard from '@/components/VehicleCard.vue';
import { listVehicles } from '@/api/mini';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleStatus } from '@/types/vehicle';
import { redirectToNav, type NavKey } from '@/utils/navKey';

const VEHICLE_SELECTION_STORAGE_KEY = 'tour:selectedVehicleId';
const VEHICLE_SELECTION_OBJECT_STORAGE_KEY = 'tour:selectedVehicle';

function getSelectedVehicleId(): string | null {
  try {
    const value = uni.getStorageSync(VEHICLE_SELECTION_STORAGE_KEY);
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

async function reload() {
  vehicles.value = await listVehicles();
}

onMounted(() => {
  void reload().catch(() => {
    uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

function select(id: string, status: VehicleStatus) {
  if (status === 'locked') {
    uni.showToast({ title: '未解锁', icon: 'none' });
    return;
  }
  const selectedVehicle = vehicles.value.find((item) => item.id === id) || null;
  selectedId.value = id;
  setSelectedVehicleId(id);
  setSelectedVehicle(selectedVehicle);
  uni.showToast({ title: '已选择', icon: 'none' });
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
