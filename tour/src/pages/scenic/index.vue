<template>
  <view class="page">
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input v-model="keyword" class="search-input" type="text" placeholder="搜索景区名称" confirm-type="search" />
        <text v-if="keyword" class="clear-icon" @tap="keyword = ''">✕</text>
      </view>
    </view>

    <view class="content">
      <view class="section-title">
        <text class="section-text">全部景区</text>
      </view>

      <view class="grid">
        <ScenicCard
          v-for="scenic in filtered"
          :key="scenic.id"
          :name="scenic.title"
          :summary="scenic.description"
          :cover-url="(scenic.slides && scenic.slides[0]) || scenic.coverImage || ''"
          :rating="scenic.averageRating"
          @tap="openDetail(scenic.id)"
        />
      </view>

      <view v-if="!filtered.length" class="empty">
        <text>没有找到景区</text>
      </view>
    </view>

    <BottomNav active="scenic" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BottomNav from '@/components/BottomNav.vue'
import ScenicCard from '@/components/ScenicCard.vue'
import { listScenics } from '@/api/mini'
import { redirectToNav, type NavKey } from '@/utils/navKey'
import type { ScenicSummary } from '@/types/scenic'

const keyword = ref('')
const scenics = ref<ScenicSummary[]>([])

async function reload() {
  const all = await listScenics()
  scenics.value = Array.isArray(all) ? all : []
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' })
  })
})

const filtered = computed(() => {
  const k = keyword.value.trim()
  if (!k) return scenics.value
  return scenics.value.filter((s) => s.title.includes(k) || s.description.includes(k))
})

function openDetail(id: string) {
  void uni.navigateTo({ url: `/pages/scenic/detail?id=${encodeURIComponent(id)}` })
}

function handleNavigate(key: NavKey) {
  redirectToNav(key)
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
  padding: 16px 16px 10px;
}

.search-box {
  background: #ffffff;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.clear-icon {
  font-size: 14px;
  color: #a8b0c1;
}

.content {
  padding: 0 16px 18px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 0 10px;
}

.section-text {
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.empty {
  padding: 40px 0;
  text-align: center;
  color: #8a94a6;
}
</style>
