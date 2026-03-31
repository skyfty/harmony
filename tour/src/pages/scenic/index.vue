<template>
  <view class="page">
    <PageHeader :title="headerTitle" />

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

      <view class="filter-tabs">
        <view :class="['tab', { active: activeFilter === 'all' }]" @tap="setFilter('all')">全部景区</view>
        <view :class="['tab', { active: activeFilter === 'hot' }]" @tap="setFilter('hot')">热门景区</view>
        <view :class="['tab', { active: activeFilter === 'featured' }]" @tap="setFilter('featured')">精选景区</view>
      </view>

      <view class="section-title">
        <text class="section-text">{{ headerTitle }}</text>
      </view>

      <view class="grid">
        <view
          v-for="scenic in filtered"
          :key="scenic.id"
          class="card-item"
        >
          <ScenicCard
            :name="scenic.title"
              :distance="scenic.distance"
              :rating-count="scenic.ratingCount"
              :address="scenic.address"
            :summary="scenic.description"
            :cover-url="(scenic.slides && scenic.slides[0]) || scenic.coverImage || ''"
            :rating="scenic.averageRating"
            :is-featured="scenic.isFeatured"
            :is-hot="scenic.isHot"
            variant="list"
            @tap="openDetail(scenic.id)"
          />
        </view>
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
const activeFilter = ref<'all' | 'hot' | 'featured'>('all')

const headerTitle = computed(() => {
  if (activeFilter.value === 'hot') return '热门景区'
  if (activeFilter.value === 'featured') return '精选景区'
  return '全部景区'
})

function setFilter(f: 'all' | 'hot' | 'featured') {
  activeFilter.value = f
}
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
  let list = Array.isArray(scenics.value) ? scenics.value.slice() : []

  if (k) {
    list = list.filter((s) => (s.title || '').includes(k) || (s.description || '').includes(k))
  }

  if (activeFilter.value === 'hot') {
    list = list.filter((s) => !!s.isHot)
  } else if (activeFilter.value === 'featured') {
    list = list.filter((s) => !!s.isFeatured)
  }

  return list
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
  padding-bottom: 65px;
  padding-bottom: calc(65px + constant(safe-area-inset-bottom));
  padding-bottom: calc(65px + env(safe-area-inset-bottom));
}

.header {
  padding: 16px 16px 10px;
}

.search-box {
  margin-top: 12px;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 14px;
  padding: 11px 12px;
  display: flex;
  align-items: center;
.search-input {
  flex: 1;
  font-size: 13px;
  color: #55617a;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
}
.search-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 0;
  background: transparent;
}
  height: 36px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
}

.search-button-text {
  display: none;
}

.search-icon {
  width: 18px;
  height: 18px;
  color: #7b74e7;
  flex-shrink: 0;
}

.filter-tabs {
  display: flex;
  gap: 8px;
  margin: 12px 0;
  background: transparent;
}

.tab {
  padding: 8px 12px;
  background: rgba(255,255,255,0.95);
  border-radius: 999px;
  font-size: 13px;
  color: #55617a;
  box-shadow: 0 6px 14px rgba(23, 43, 77, 0.06);
}

.tab.active {
  background: #7b74e7;
  color: #fff;
  box-shadow: 0 8px 18px rgba(123,116,231,0.16);
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
  margin: 6px 0 10px;
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

.card-item {
  overflow: visible;
}

.empty {
  padding: 40px 0;
  text-align: center;
  color: #8a94a6;
}
</style>
