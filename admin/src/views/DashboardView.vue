<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchDashboardMetrics } from '@/api/modules/dashboard'
import type { DashboardMetrics } from '@/types'

const metrics = ref<DashboardMetrics | null>(null)
const loading = ref(true)
const errorMessage = ref<string | null>(null)

async function loadMetrics(): Promise<void> {
  try {
    loading.value = true
    errorMessage.value = null
    metrics.value = await fetchDashboardMetrics()
  } catch (error) {
    console.error('Failed to fetch dashboard metrics', error)
    errorMessage.value = '无法获取仪表盘数据，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadMetrics()
})
</script>

<template>
  <div>
    <v-row>
      <v-col cols="12" md="4">
        <v-card elevation="3" class="pa-4">
          <v-icon icon="mdi-account-group" size="32" class="mb-2 text-primary" />
          <div class="text-subtitle-2 text-medium-emphasis">用户总数</div>
          <div class="text-h4 font-weight-medium">{{ metrics?.users ?? '--' }}</div>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card elevation="3" class="pa-4">
          <v-icon icon="mdi-account-key" size="32" class="mb-2 text-primary" />
          <div class="text-subtitle-2 text-medium-emphasis">角色总数</div>
          <div class="text-h4 font-weight-medium">{{ metrics?.roles ?? '--' }}</div>
        </v-card>
      </v-col>
      <v-col cols="12" md="4">
        <v-card elevation="3" class="pa-4">
          <v-icon icon="mdi-folder-multiple-image" size="32" class="mb-2 text-primary" />
          <div class="text-subtitle-2 text-medium-emphasis">资产数量</div>
          <div class="text-h4 font-weight-medium">{{ metrics?.assets ?? '--' }}</div>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-6">
      <v-col cols="12" md="7">
        <v-card elevation="3" class="pa-4">
          <v-card-title class="text-h6 font-weight-medium">最近活动</v-card-title>
          <v-divider class="my-2" />
          <v-skeleton-loader v-if="loading" type="list-item-three-line@5" />
          <template v-else>
            <v-alert v-if="errorMessage" type="error" density="compact">
              {{ errorMessage }}
            </v-alert>
            <v-list v-else-if="metrics?.recentActivities?.length" density="compact">
              <v-list-item
                v-for="activity in metrics?.recentActivities"
                :key="activity.id"
                :title="activity.description"
                :subtitle="activity.createdAt"
              >
                <template #prepend>
                  <v-avatar color="primary" variant="tonal">
                    <v-icon icon="mdi-history" />
                  </v-avatar>
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-medium-emphasis">
              暂无活动记录
            </div>
          </template>
        </v-card>
      </v-col>
      <v-col cols="12" md="5">
        <v-card elevation="3" class="pa-4">
          <v-card-title class="text-h6 font-weight-medium">资源上传概述</v-card-title>
          <v-divider class="my-2" />
          <div class="text-medium-emphasis">
            资源管理模块可用于维护 Editor 所需的模型、纹理、HDR 等资源。请在左侧导航进入资源管理页面完成上传与分类。
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
