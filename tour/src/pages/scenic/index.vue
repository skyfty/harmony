<template>
  <view class="page">
    <PageHeader title="全部景区" :show-back="false" />

    <view class="content">
      <view class="search-box">
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="请输入景点名称"
          confirm-type="search"
          @input="handleKeywordInput"
          @confirm="handleSearch"
        />
        <view class="search-button" @tap="handleSearch" role="button" aria-label="搜索">
          <svg class="search-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </view>
      </view>

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
import PageHeader from '@/components/PageHeader.vue'
import ScenicCard from '@/components/ScenicCard.vue'
import { listScenics } from '@/api/mini'
import { redirectToNav, type NavKey } from '@/utils/navKey'
import type { ScenicSummary } from '@/types/scenic'

const keyword = ref('')
const scenics = ref<ScenicSummary[]>([])
const listScenicsSafe = listScenics as (query?: { featured?: boolean; q?: string }) => Promise<ScenicSummary[]>
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function reload(searchKeyword?: string) {
  const q = searchKeyword?.trim()
  const all = await listScenicsSafe(q ? { q } : undefined)
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

function handleKeywordInput() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    void reload(keyword.value).catch(() => {
      void uni.showToast({ title: '加载失败', icon: 'none' })
    })
  }, 300)
}

function handleSearch() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  void reload(keyword.value).catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' })
  })
}

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
  margin-top: 12px;
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

.search-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8cff, #8a63ff);
}

.search-button-text {
  display: none;
}

.search-icon {
  width: 16px;
  height: 16px;
  color: #ffffff;
  display: block;
}

.clear-icon {
  font-size: 14px;
  color: #a8b0c1;
}

.content {
  padding: 12px 16px 18px;
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
