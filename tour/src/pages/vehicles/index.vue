<template>
  <view class="page">
    <view class="header">
      <text class="title">代步工具</text>
      <text class="subtitle">选择偏好车型（不影响 3D 内实际可驾驶车辆）</text>
    </view>
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
import BottomNav from '@/components/BottomNav.vue';
import VehicleCard from '@/components/VehicleCard.vue';
import { listVehicles } from '@/api/mini';
import { getSelectedVehicleId, setSelectedVehicleId } from '@/mocks/vehicles';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleStatus } from '@/types/vehicle';
import { redirectToNav, type NavKey } from '@/utils/navKey';

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
  selectedId.value = id;
  setSelectedVehicleId(id);
  uni.showToast({ title: '已选择', icon: 'none' });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.header {
  padding: 16px;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.subtitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #8a94a6;
}

.content {
  padding: 0 16px 18px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
</style>
