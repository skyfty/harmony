<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchDashboardMetrics } from '@/api/modules/dashboard'
import type { DashboardMetrics } from '@/types'

interface SummaryCard {
  id: string
  title: string
  value: string
  icon: string
  change: number
  changeLabel: string
  color: string
  sparkline: number[]
}

interface ResourceHighlight {
  id: string
  title: string
  description: string
  icon: string
  color: string
}

const metrics = ref<DashboardMetrics | null>(null)
const loading = ref(true)
const errorMessage = ref<string | null>(null)

const numberFormatter = new Intl.NumberFormat('zh-CN')

const summaryCards = computed<SummaryCard[]>(() => {
  const data = metrics.value
  return [
    {
      id: 'users',
      title: '活跃用户',
      value: data ? numberFormatter.format(data.users) : '--',
      icon: 'mdi-account-group-outline',
      change: 18,
      changeLabel: '较上月',
      color: 'primary',
      sparkline: [28, 32, 30, 36, 42, 45, 48],
    },
    {
      id: 'roles',
      title: '角色配置',
      value: data ? numberFormatter.format(data.roles) : '--',
      icon: 'mdi-shield-account-outline',
      change: 6,
      changeLabel: '本周更新',
      color: 'info',
      sparkline: [6, 7, 8, 8, 9, 11, 12],
    },
    {
      id: 'assets',
      title: '资产库',
      value: data ? numberFormatter.format(data.assets) : '--',
      icon: 'mdi-folder-multiple-outline',
      change: 34,
      changeLabel: '新增资源',
      color: 'success',
      sparkline: [120, 140, 132, 155, 162, 174, 188],
    },
  ]
})

const resourceHighlights: ResourceHighlight[] = [
  {
    id: 'models',
    title: '模型资源',
    description: '近 24 小时新增 18 项',
    icon: 'mdi-cube-outline',
    color: 'primary',
  },
  {
    id: 'textures',
    title: '纹理材质',
    description: '共有 126 套，可用率 98%',
    icon: 'mdi-texture-box',
    color: 'info',
  },
  {
    id: 'hdr',
    title: 'HDR 全景',
    description: '新增 6 张室外天空光源',
    icon: 'mdi-weather-partly-cloudy',
    color: 'success',
  },
  {
    id: 'others',
    title: '脚本与配置',
    description: '常用模板 24 个，昨日下载 52 次',
    icon: 'mdi-file-table-box-multiple-outline',
    color: 'warning',
  },
]

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

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
  <div class="dashboard-page">
  <v-row class="dashboard-row">
        <v-col cols="12" md="8">
        <v-card class="dashboard-hero" elevation="4">
          <v-card-text class="d-flex flex-column flex-md-row align-start align-md-center">
            <div class="dashboard-hero__content">
              <div class="text-subtitle-1 text-high-emphasis mb-2">欢迎回来，管理员 👋</div>
              <h2 class="text-h4 text-white mb-3">Harmony 控制中心实时概览</h2>
              <p class="text-body-2 text-white text-opacity-70 mb-4">
                快速了解用户活跃、角色授权以及资源库状态。使用右侧快速入口发起常用操作。
              </p>
              <div class="d-flex flex-wrap gap-3">
                <v-btn color="white" class="text-primary" variant="elevated" prepend-icon="mdi-view-dashboard">
                  查看分析报表
                </v-btn>
                <v-btn variant="tonal" color="white" class="text-white" prepend-icon="mdi-upload">
                  上传资源
                </v-btn>
              </div>
            </div>
            <div class="dashboard-hero__metrics ms-md-auto mt-6 mt-md-0">
              <div class="text-caption text-white text-opacity-70 mb-2">本周系统运行情况</div>
              <div class="dashboard-hero__spark">
                <v-progress-circular
                  :size="110"
                  :width="8"
                  color="white"
                  model-value="82"
                >
                  <div class="text-white text-h5">82%</div>
                </v-progress-circular>
                <div class="ms-5">
                  <div class="text-white text-subtitle-1 font-weight-medium">任务执行成功率</div>
                  <div class="text-white text-opacity-70">
                    近 7 天共处理 284 次资源同步任务，失败 11 次。
                  </div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-row class="dashboard-row--inner">
          <v-col v-for="card in summaryCards" :key="card.id" cols="12">
            <v-card class="stat-card" :color="`${card.color}-lighten-5`" variant="flat">
              <v-card-text>
                <div class="d-flex align-center justify-space-between">
                  <div class="stat-card__icon">
                    <v-avatar :color="card.color" variant="tonal" size="44">
                      <v-icon :icon="card.icon" size="22" />
                    </v-avatar>
                  </div>
                  <v-chip :color="card.color" size="small" variant="tonal">
                    {{ card.change > 0 ? '+' : '' }}{{ card.change }}% {{ card.changeLabel }}
                  </v-chip>
                </div>
                <div class="stat-card__content">
                  <div class="text-body-2 text-medium-emphasis">{{ card.title }}</div>
                  <div class="text-h5 font-weight-medium mt-1">{{ card.value }}</div>
                </div>
                <v-sparkline
                  :value="card.sparkline"
                  :color="card.color"
                  smooth
                  line-width="3"
                  padding="6"
                />
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-col>
    </v-row>

  <v-row class="dashboard-row mt-1">
        <v-col cols="12" md="7">
        <v-card elevation="3" class="section-card">
          <v-card-title class="d-flex align-center justify-space-between">
            <span class="text-subtitle-1 font-weight-medium">最近活动</span>
            <v-chip size="small" color="primary" variant="tonal">实时</v-chip>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <v-skeleton-loader
              v-if="loading"
              type="list-item-three-line@4"
            />
            <template v-else>
              <v-alert
                v-if="errorMessage"
                type="error"
                density="comfortable"
                variant="tonal"
                class="mb-4"
              >
                {{ errorMessage }}
              </v-alert>
              <v-list
                v-else-if="metrics?.recentActivities?.length"
                density="comfortable"
                lines="three"
                class="activity-list"
              >
                <v-list-item
                  v-for="activity in metrics?.recentActivities"
                  :key="activity.id"
                >
                  <template #prepend>
                    <v-avatar color="primary" variant="tonal" size="38">
                      <v-icon icon="mdi-history" />
                    </v-avatar>
                  </template>
                  <v-list-item-title class="font-weight-medium">{{ activity.description }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ formatTimestamp(activity.createdAt) }} · {{ activity.type }}
                  </v-list-item-subtitle>
                  <template #append>
                    <v-btn variant="text" size="small" color="primary">详情</v-btn>
                  </template>
                </v-list-item>
              </v-list>
              <div v-else class="text-medium-emphasis text-center py-6">
                暂无活动记录，欢迎稍后再来查看。
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="5">
        <v-card elevation="3" class="section-card">
          <v-card-title class="d-flex align-center justify-space-between">
            <span class="text-subtitle-1 font-weight-medium">资源上传概览</span>
            <v-chip size="small" color="success" variant="tonal">健康</v-chip>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <div class="d-flex align-center justify-space-between mb-6">
              <div>
                <div class="text-h5 font-weight-medium">
                  {{ numberFormatter.format(metrics?.assets ?? 0) }}
                </div>
                <div class="text-body-2 text-medium-emphasis">总资源数量</div>
              </div>
              <v-progress-circular
                :model-value="72"
                :size="70"
                :width="8"
                color="success"
              >
                <span class="text-subtitle-2">72%</span>
              </v-progress-circular>
            </div>
            <v-row class="dashboard-row--compact">
              <v-col
                v-for="item in resourceHighlights"
                :key="item.id"
                cols="12"
                sm="6"
              >
                <v-sheet
                  rounded="lg"
                  class="pa-4 resource-chip"
                  elevation="0"
                  :class="`resource-chip--${item.color}`"
                >
                  <div class="d-flex align-center justify-space-between">
                    <div>
                      <div class="text-subtitle-2 font-weight-medium">{{ item.title }}</div>
                      <div class="text-caption text-medium-emphasis">{{ item.description }}</div>
                    </div>
                    <v-avatar :color="item.color" variant="tonal" size="40">
                      <v-icon :icon="item.icon" />
                    </v-avatar>
                  </div>
                </v-sheet>
              </v-col>
            </v-row>
            <v-btn block variant="tonal" class="mt-4" color="primary" prepend-icon="mdi-open-in-new">
              前往资源管理
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

  <v-row class="dashboard-row mt-1">
        <v-col cols="12" md="4">
        <v-card class="section-card" elevation="3">
          <v-card-title class="text-subtitle-1 font-weight-medium">系统健康度</v-card-title>
          <v-divider />
          <v-card-text class="d-flex flex-column gap-5 pt-6">
            <div>
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-body-2">API 服务</span>
                <span class="text-body-2 font-weight-medium">99.2%</span>
              </div>
              <v-progress-linear model-value="99.2" color="primary" height="8" rounded />
            </div>
            <div>
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-body-2">数据库</span>
                <span class="text-body-2 font-weight-medium">97.6%</span>
              </div>
              <v-progress-linear model-value="97.6" color="info" height="8" rounded />
            </div>
            <div>
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-body-2">资源 CDN</span>
                <span class="text-body-2 font-weight-medium">93.4%</span>
              </div>
              <v-progress-linear model-value="93.4" color="success" height="8" rounded />
            </div>
            <v-alert type="info" variant="tonal" density="comfortable">
              下周将升级资源 CDN，预计新加坡节点性能提升 20%。
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card class="section-card" elevation="3">
          <v-card-title class="text-subtitle-1 font-weight-medium">自动化任务</v-card-title>
          <v-divider />
          <v-card-text>
            <v-timeline density="compact" line-color="primary">
              <v-timeline-item dot-color="primary" size="small">
                <template #opposite>09:30</template>
                <div class="font-weight-medium">逐日资产同步</div>
                <div class="text-caption text-medium-emphasis">已完成 · 同步 64 项资产</div>
              </v-timeline-item>
              <v-timeline-item dot-color="success" size="small">
                <template #opposite>11:00</template>
                <div class="font-weight-medium">权限差异检测</div>
                <div class="text-caption text-medium-emphasis">运行中 · 未发现异常</div>
              </v-timeline-item>
              <v-timeline-item dot-color="warning" size="small">
                <template #opposite>14:30</template>
                <div class="font-weight-medium">资源备份</div>
                <div class="text-caption text-medium-emphasis">排队中 · 预计 15 分钟</div>
              </v-timeline-item>
            </v-timeline>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card class="section-card" elevation="3">
          <v-card-title class="text-subtitle-1 font-weight-medium">快捷操作</v-card-title>
          <v-divider />
          <v-card-text class="d-flex flex-column gap-3">
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-account-plus" block>
              创建新用户
            </v-btn>
            <v-btn color="success" variant="tonal" prepend-icon="mdi-shield-account" block>
              审核角色权限
            </v-btn>
            <v-btn color="info" variant="tonal" prepend-icon="mdi-file-upload" block>
              导入资源包
            </v-btn>
            <v-btn color="warning" variant="tonal" prepend-icon="mdi-cog" block>
              系统配置
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<style scoped lang="scss">
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.dashboard-row {
  gap: 1.5rem;
}

.dashboard-row--inner {
  gap: 1rem;
}

.dashboard-row--compact {
  gap: 0.75rem;
}

.dashboard-hero {
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(79, 70, 229, 1) 0%, rgba(14, 165, 233, 0.92) 100%);
  box-shadow: 0 30px 60px rgba(79, 70, 229, 0.25);
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle at top right, rgba(255, 255, 255, 0.25), transparent 55%);
    pointer-events: none;
  }

  &__content {
    position: relative;
    z-index: 1;
    max-inline-size: 460px;
  }

  &__metrics {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    position: relative;
    z-index: 1;
  }

  &__spark {
    display: flex;
    align-items: center;
  }
}

.stat-card {
  border-radius: 18px;
  box-shadow: none;

  &__content {
    margin-block: 1.25rem 0.75rem;
  }
}

.section-card {
  border-radius: 18px;
}

.activity-list {
  background-color: transparent;
}

.resource-chip {
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(var(--v-theme-primary), 0.12);
  }
}

.resource-chip--primary {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
}

.resource-chip--info {
  background: rgba(var(--v-theme-info), 0.06);
  border: 1px solid rgba(var(--v-theme-info), 0.14);
  box-shadow: 0 10px 25px rgba(var(--v-theme-info), 0.04);
}

.resource-chip--success {
  background: rgba(var(--v-theme-success), 0.06);
  border: 1px solid rgba(var(--v-theme-success), 0.14);
  box-shadow: 0 10px 25px rgba(var(--v-theme-success), 0.04);
}

.resource-chip--warning {
  background: rgba(var(--v-theme-warning), 0.06);
  border: 1px solid rgba(var(--v-theme-warning), 0.14);
  box-shadow: 0 10px 25px rgba(var(--v-theme-warning), 0.04);
}

@media (max-width: 1280px) {
  .dashboard-hero__content {
    max-inline-size: 100%;
  }
}

@media (max-width: 960px) {
  .dashboard-hero {
    border-radius: 16px;
  }
}
</style>
