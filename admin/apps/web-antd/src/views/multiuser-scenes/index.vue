<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'

import {
  clearMultiuserRuntimeRoomApi,
  getMultiuserRuntimeRoomApi,
  kickMultiuserRuntimeConnectionApi,
  kickMultiuserRuntimeUserApi,
  listMultiuserRuntimeRoomsApi,
  type MultiuserRuntimeActivityItem,
  type MultiuserRuntimeEntityItem,
  type MultiuserRuntimePeerItem,
  type MultiuserRuntimeRoomDetail,
  type MultiuserRuntimeRoomItem,
  type MultiuserRuntimePeerState,
} from '#/api'

import { computed, onMounted, ref } from 'vue'

import { Button, Card, Col, Descriptions, Drawer, Empty, Input, Modal, Row, Select, Space, Spin, Statistic, Table, Tag, Timeline, message } from 'ant-design-vue'
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons-vue'

type RoomStatusFilter = 'all' | 'active'
type ActivityTimelineFilter = 'all' | 'peer' | 'entity' | 'admin'
type RoomLike = {
  sceneId?: string
  sceneName?: string | null
}
type PeerLike = {
  sessionId?: string
  userId?: string
  displayName?: string | null
  connectedAt?: string | null
  lastActiveAt?: string | null
  remoteAddress?: string | null
  forwardedFor?: string | null
  origin?: string | null
  userAgent?: string | null
  state?: MultiuserRuntimePeerState | null
}

const rooms = ref<MultiuserRuntimeRoomItem[]>([])
const roomsLoading = ref(false)
const selectedSceneId = ref<string | null>(null)
const selectedRoom = ref<MultiuserRuntimeRoomDetail | null>(null)
const selectedPeerSessionId = ref<string | null>(null)
const selectedRoomLoading = ref(false)
const roomKeyword = ref('')
const roomStatusFilter = ref<RoomStatusFilter>('active')
const activityTimelineFilter = ref<ActivityTimelineFilter>('all')
const activityTimelineKeyword = ref('')
const lastUpdatedAt = ref<string | null>(null)

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

const roomColumns: TableColumnsType<MultiuserRuntimeRoomItem> = [
  {
    title: '场景',
    dataIndex: 'sceneName',
    key: 'sceneName',
    width: 220,
  },
  {
    title: '场景 ID',
    dataIndex: 'sceneId',
    key: 'sceneId',
    width: 220,
  },
  {
    title: '在线用户',
    dataIndex: 'userCount',
    key: 'userCount',
    width: 110,
  },
  {
    title: '上限',
    dataIndex: 'maxUsers',
    key: 'maxUsers',
    width: 100,
  },
  {
    title: '共享实体',
    dataIndex: 'entityCount',
    key: 'entityCount',
    width: 110,
  },
  {
    title: '最近活动',
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    width: 180,
  },
  {
    title: '操作',
    key: 'actions',
    fixed: 'right',
    width: 260,
  },
]

const peerColumns: TableColumnsType<MultiuserRuntimePeerItem> = [
  { title: '用户', key: 'user', width: 240 },
  { title: '连接 ID', dataIndex: 'sessionId', key: 'sessionId', width: 200 },
  { title: '接入时间', dataIndex: 'connectedAt', key: 'connectedAt', width: 180 },
  { title: '最近活跃', dataIndex: 'lastActiveAt', key: 'lastActiveAt', width: 180 },
  { title: '状态', key: 'state', width: 280 },
  { title: '来源', key: 'source', width: 240 },
  { title: '操作', key: 'peerActions', width: 240 },
]

const entityColumns: TableColumnsType<MultiuserRuntimeEntityItem> = [
  { title: '实体 ID', dataIndex: 'entityId', key: 'entityId', width: 220 },
  { title: '节点 ID', key: 'nodeId', width: 200 },
  { title: '拥有者', key: 'ownerUserId', width: 180 },
  { title: '版本', key: 'revision', width: 100 },
  { title: '最近更新', key: 'updatedAt', width: 180 },
  { title: '位置', key: 'position', width: 220 },
]

const filteredRooms = computed(() => {
  const keyword = roomKeyword.value.trim().toLowerCase()
  return rooms.value.filter((room) => {
    if (roomStatusFilter.value === 'active' && room.userCount <= 0) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [
      room.sceneId,
      room.sceneName ?? '',
    ].some((value) => value.toLowerCase().includes(keyword))
  })
})

const totalRooms = computed(() => filteredRooms.value.length)
const totalUsers = computed(() => filteredRooms.value.reduce((sum, room) => sum + room.userCount, 0))
const totalEntities = computed(() => filteredRooms.value.reduce((sum, room) => sum + room.entityCount, 0))
const selectedPeer = computed(() => {
  if (!selectedRoom.value || !selectedPeerSessionId.value) {
    return null
  }
  return selectedRoom.value.connections.find((peer) => peer.sessionId === selectedPeerSessionId.value) ?? null
})
const roomActivities = computed(() => filterActivities(selectedRoom.value?.activities ?? []))
const selectedPeerOwnedEntities = computed(() => {
  const peer = selectedPeer.value
  if (!peer?.userId || !selectedRoom.value) {
    return []
  }
  return selectedRoom.value.entities.filter((entity) => entity.state?.ownerUserId === peer.userId)
})
const selectedPeerActivities = computed(() => {
  const peer = selectedPeer.value
  if (!peer || !selectedRoom.value) {
    return []
  }
  return filterActivities(
    selectedRoom.value.activities.filter((activity) => activity.sessionId === peer.sessionId || activity.userId === peer.userId),
  )
})
const selectedPeerSiblingConnections = computed(() => {
  const peer = selectedPeer.value
  if (!peer?.userId || !selectedRoom.value) {
    return []
  }
  return selectedRoom.value.connections.filter((item) => item.userId === peer.userId && item.sessionId !== peer.sessionId)
})

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) {
    return value
  }
  return timeFormatter.format(time)
}

function formatPeerState(state: MultiuserRuntimePeerState | null | undefined): string {
  if (!state) {
    return '-'
  }
  const subject = state.subjectIdentifier?.trim() || state.subjectNodeId || state.subjectAssetId || state.subjectType
  const action = state.action?.trim()
  return action ? `${state.subjectType}:${subject} · ${action}` : `${state.subjectType}:${subject}`
}

function formatPeerStatePosition(state: MultiuserRuntimePeerState | null | undefined): string {
  if (!state) {
    return '-'
  }
  return `${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}, ${state.position.z.toFixed(2)}`
}

function formatRuntimeUserLabel(peer: PeerLike | null | undefined): string {
  if (!peer) {
    return '-'
  }
  const userId = peer.userId || '-'
  return `${peer.displayName || userId} (${userId})`
}

function formatRuntimeConnectionSource(peer: PeerLike | null | undefined): string {
  if (!peer) {
    return '-'
  }
  const parts = [peer.remoteAddress, peer.forwardedFor, peer.origin].filter((item) => item && item.trim().length > 0)
  return parts.length ? parts.join(' · ') : '-'
}

function formatRuntimeUserAgent(peer: PeerLike | null | undefined): string {
  if (!peer?.userAgent) {
    return '-'
  }
  return peer.userAgent
}

function getActivityTagColor(activity: MultiuserRuntimeActivityItem | null | undefined): string {
  if (!activity) {
    return 'default'
  }
  if (activity.type.startsWith('admin-')) {
    return 'red'
  }
  if (activity.type === 'peer-connected') {
    return 'green'
  }
  if (activity.type === 'peer-disconnected') {
    return 'orange'
  }
  if (activity.type === 'entity-state') {
    return 'cyan'
  }
  if (activity.type === 'peer-state') {
    return 'purple'
  }
  return 'default'
}

function formatActivityLabel(activity: MultiuserRuntimeActivityItem | null | undefined): string {
  if (!activity) {
    return '-'
  }
  const labelMap: Record<MultiuserRuntimeActivityItem['type'], string> = {
    'peer-connected': '用户连接',
    'peer-disconnected': '用户离线',
    'peer-state': '状态更新',
    'entity-state': '实体更新',
    'entity-removed': '实体移除',
    'admin-kick-connection': '管理员踢连接',
    'admin-kick-user': '管理员踢用户',
    'admin-clear': '管理员清房',
  }
  return labelMap[activity.type] || activity.type
}

function formatActivityFilterLabel(filter: ActivityTimelineFilter): string {
  const labelMap: Record<ActivityTimelineFilter, string> = {
    all: '全部活动',
    peer: '连接/离线/状态',
    entity: '共享实体',
    admin: '管理员动作',
  }
  return labelMap[filter]
}

function matchesActivityFilter(activity: MultiuserRuntimeActivityItem, filter: ActivityTimelineFilter): boolean {
  if (filter === 'all') {
    return true
  }
  if (filter === 'admin') {
    return activity.type.startsWith('admin-')
  }
  if (filter === 'peer') {
    return activity.type === 'peer-connected' || activity.type === 'peer-disconnected' || activity.type === 'peer-state'
  }
  if (filter === 'entity') {
    return activity.type === 'entity-state' || activity.type === 'entity-removed'
  }
  return true
}

function filterActivities(activities: MultiuserRuntimeActivityItem[]): MultiuserRuntimeActivityItem[] {
  const keyword = activityTimelineKeyword.value.trim().toLowerCase()
  return activities.filter((activity) => {
    if (!matchesActivityFilter(activity, activityTimelineFilter.value)) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [
      activity.summary,
      activity.displayName ?? '',
      activity.sessionId ?? '',
      activity.userId ?? '',
      activity.entityId ?? '',
      activity.nodeId ?? '',
      activity.type,
    ].some((value) => value.toLowerCase().includes(keyword))
  })
}

function buildSelectedRoomSnapshot(): Record<string, unknown> | null {
  const room = selectedRoom.value
  if (!room) {
    return null
  }
  return {
    generatedAt: new Date().toISOString(),
    room,
    selectedPeer: selectedPeer.value,
    selectedPeerActivities: selectedPeerActivities.value,
    roomActivities: roomActivities.value,
  }
}

function getRoomStatusColor(room: RoomLike | null | undefined): string {
  if (!room) {
    return 'default'
  }
  if ((room as MultiuserRuntimeRoomItem).userCount <= 0) {
    return 'default'
  }
  if ((room as MultiuserRuntimeRoomItem).userCount >= (room as MultiuserRuntimeRoomItem).maxUsers) {
    return 'red'
  }
  return 'green'
}

function showSceneDetail(sceneId: string | null | undefined): void {
  if (!sceneId) {
    return
  }
  const currentSceneId = sceneId
  selectedSceneId.value = currentSceneId
  selectedPeerSessionId.value = null
  void loadRoomDetail(currentSceneId)
}

async function refreshRooms(): Promise<void> {
  roomsLoading.value = true
  try {
    const response = await listMultiuserRuntimeRoomsApi()
    rooms.value = response.rooms ?? []
    lastUpdatedAt.value = response.updatedAt ?? null
    if (selectedSceneId.value && !rooms.value.some((room) => room.sceneId === selectedSceneId.value)) {
      selectedSceneId.value = null
      selectedRoom.value = null
      selectedPeerSessionId.value = null
    } else if (selectedSceneId.value) {
      void loadRoomDetail(selectedSceneId.value)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '刷新房间列表失败')
  } finally {
    roomsLoading.value = false
  }
}

async function loadRoomDetail(sceneId: string): Promise<void> {
  const targetSceneId = sceneId
  selectedRoomLoading.value = true
  try {
    const room = await getMultiuserRuntimeRoomApi(targetSceneId)
    if (selectedSceneId.value !== targetSceneId) {
      return
    }
    selectedRoom.value = room
    if (!selectedPeerSessionId.value || !room.connections.some((peer) => peer.sessionId === selectedPeerSessionId.value)) {
      selectedPeerSessionId.value = room.connections[0]?.sessionId ?? null
    }
  } catch (error) {
    if (selectedSceneId.value === targetSceneId) {
      selectedRoom.value = null
      message.error(error instanceof Error ? error.message : '加载房间详情失败')
    }
  } finally {
    if (selectedSceneId.value === targetSceneId) {
      selectedRoomLoading.value = false
    }
  }
}

function selectPeer(peer: PeerLike | null | undefined): void {
  if (!peer?.sessionId) {
    return
  }
  selectedPeerSessionId.value = peer.sessionId
}

function exportSelectedRoomSnapshot(): void {
  const snapshot = buildSelectedRoomSnapshot()
  if (!snapshot) {
    return
  }
  const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const room = selectedRoom.value
  anchor.href = url
  anchor.download = `multiuser-runtime-${room?.sceneId ?? 'room'}-${Date.now()}.json`
  anchor.click()
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
  message.success('已导出快照')
}

async function copySelectedRoomSnapshot(): Promise<void> {
  const snapshot = buildSelectedRoomSnapshot()
  if (!snapshot) {
    return
  }
  const text = `${JSON.stringify(snapshot, null, 2)}\n`
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    message.success('已复制快照')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制快照失败')
  }
}

function confirmKickPeer(room: RoomLike | null | undefined, peer: PeerLike | null | undefined): void {
  const sceneId = room?.sceneId
  const sessionId = peer?.sessionId
  const userId = peer?.userId
  if (!sceneId || !sessionId || !userId) {
    return
  }
  Modal.confirm({
    title: `踢出 ${peer.displayName || userId} ?`,
    content: `将断开该用户连接（${sessionId}）。`,
    okType: 'danger',
    okText: '踢出',
    cancelText: '取消',
    onOk: async () => {
      await kickMultiuserRuntimeConnectionApi(sceneId, sessionId)
      message.success('已踢出连接')
    },
  })
}

function confirmKickUser(room: RoomLike | null | undefined, peer: PeerLike | null | undefined): void {
  const sceneId = room?.sceneId
  const userId = peer?.userId
  if (!sceneId || !userId) {
    return
  }
  Modal.confirm({
    title: `踢出用户 ${peer.displayName || userId} ?`,
    content: '将断开该用户在当前场景内的全部连接。',
    okType: 'danger',
    okText: '踢出',
    cancelText: '取消',
    onOk: async () => {
      await kickMultiuserRuntimeUserApi(sceneId, userId)
      message.success('已踢出用户')
    },
  })
}

function confirmClearRoom(room: RoomLike | null | undefined): void {
  const sceneId = room?.sceneId
  if (!sceneId) {
    return
  }
  Modal.confirm({
    title: `清空场景 ${room.sceneName || sceneId} ?`,
    content: '将断开该场景下所有在线连接，并释放当前运行态。',
    okType: 'danger',
    okText: '清空',
    cancelText: '取消',
    onOk: async () => {
      await clearMultiuserRuntimeRoomApi(sceneId)
      message.success('已清空房间')
      if (selectedSceneId.value === sceneId) {
        selectedRoom.value = null
      }
    },
  })
}

function openRoom(room: RoomLike | null | undefined): void {
  const sceneId = room?.sceneId
  if (!sceneId) {
    return
  }
  selectedSceneId.value = sceneId
  void loadRoomDetail(sceneId)
}

function closeDrawer(): void {
  selectedSceneId.value = null
  selectedRoom.value = null
  selectedPeerSessionId.value = null
}

function renderRoomDescription(room: MultiuserRuntimeRoomItem | null): string {
  if (!room) {
    return '-'
  }
  return room.sceneName ? `${room.sceneName} · ${room.sceneId}` : room.sceneId
}

onMounted(async () => {
  await refreshRooms()
})
</script>

<template>
  <div class="p-5">
    <Space direction="vertical" size="large" class="w-full">
      <Card class="multiuser-dashboard-card">
        <div class="multiuser-dashboard-header">
          <div>
            <div class="multiuser-dashboard-kicker">在线运行态管理</div>
            <h2 class="multiuser-dashboard-title">多人在线房间监控</h2>
            <div class="multiuser-dashboard-subtitle">
              手动刷新模式
              <span v-if="lastUpdatedAt"> · 最近更新 {{ formatTimestamp(lastUpdatedAt) }}</span>
            </div>
          </div>
          <Space wrap>
            <Tag color="blue">
              手动刷新
            </Tag>
            <Button :loading="roomsLoading" @click="refreshRooms">
              <ReloadOutlined />
              刷新
            </Button>
          </Space>
        </div>

        <Row :gutter="16" class="mt-4">
          <Col :xs="24" :sm="12" :lg="6">
            <Statistic title="房间数" :value="totalRooms" />
          </Col>
          <Col :xs="24" :sm="12" :lg="6">
            <Statistic title="在线用户" :value="totalUsers" />
          </Col>
          <Col :xs="24" :sm="12" :lg="6">
            <Statistic title="共享实体" :value="totalEntities" />
          </Col>
        </Row>
      </Card>

      <Card>
        <Row :gutter="12" align="middle" class="mb-4">
          <Col :xs="24" :md="12">
            <Input
              v-model:value="roomKeyword"
              allow-clear
              placeholder="按场景名称或场景 ID 搜索"
            />
          </Col>
          <Col :xs="24" :md="12">
            <Space wrap>
              <Select
                v-model:value="roomStatusFilter"
                style="width: 160px"
                :options="[
                  { label: '仅活跃房间', value: 'active' },
                  { label: '全部', value: 'all' },
                ]"
              />
              <Button @click="refreshRooms">
                <ReloadOutlined />
                刷新房间
              </Button>
            </Space>
          </Col>
        </Row>

        <Spin :spinning="roomsLoading">
          <Table
            :columns="roomColumns"
            :data-source="filteredRooms"
            :pagination="false"
            row-key="sceneId"
            :scroll="{ x: 1280 }"
          >
            <template #bodyCell="{ column, record: room }">
              <template v-if="column.key === 'sceneName'">
                <Space direction="vertical" size="small">
                  <div class="multiuser-room-name">{{ room.sceneName || '未命名场景' }}</div>
                  <div class="multiuser-room-id">{{ room.sceneId }}</div>
                </Space>
              </template>
              <template v-else-if="column.key === 'updatedAt'">
                {{ formatTimestamp(room.updatedAt) }}
              </template>
              <template v-else-if="column.key === 'actions'">
                <Space wrap>
                  <Button size="small" type="primary" @click="openRoom(room)">
                    查看
                  </Button>
                  <Button size="small" @click="showSceneDetail(room.sceneId)">
                    详情
                  </Button>
                  <Button size="small" danger @click="confirmClearRoom(room)">
                    清空
                  </Button>
                </Space>
              </template>
            </template>
            <template #emptyText>
              <Empty description="当前没有在线房间" />
            </template>
          </Table>
        </Spin>
      </Card>
    </Space>

    <Drawer
      :open="Boolean(selectedSceneId)"
      :width="1280"
      placement="right"
      title="房间详情"
      @close="closeDrawer"
    >
      <Spin :spinning="selectedRoomLoading">
        <Space direction="vertical" size="large" class="w-full">
          <Card v-if="selectedRoom" size="small">
            <div class="multiuser-room-detail-header">
              <div>
                <div class="multiuser-dashboard-kicker">运行中房间</div>
                <div class="multiuser-dashboard-title">{{ renderRoomDescription(selectedRoom) }}</div>
              </div>
              <Space wrap>
                <Tag :color="getRoomStatusColor(selectedRoom)">
                  {{ selectedRoom.userCount }} / {{ selectedRoom.maxUsers }}
                </Tag>
                <Button danger @click="confirmClearRoom(selectedRoom)">
                  <DeleteOutlined />
                  清空房间
                </Button>
              </Space>
            </div>

            <Row :gutter="16" class="mt-4">
              <Col :xs="24" :sm="12" :lg="6">
                <Statistic title="在线用户" :value="selectedRoom.userCount" />
              </Col>
              <Col :xs="24" :sm="12" :lg="6">
                <Statistic title="共享实体" :value="selectedRoom.entityCount" />
              </Col>
              <Col :xs="24" :sm="12" :lg="6">
                <Statistic title="最近更新" :value="formatTimestamp(selectedRoom.updatedAt)" />
              </Col>
            </Row>

            <Descriptions bordered :column="1" size="small" class="mt-4">
              <Descriptions.Item label="场景名称">{{ selectedRoom.sceneName || '-' }}</Descriptions.Item>
              <Descriptions.Item label="场景 ID">{{ selectedRoom.sceneId }}</Descriptions.Item>
              <Descriptions.Item label="最大用户数">{{ selectedRoom.maxUsers }}</Descriptions.Item>
              <Descriptions.Item label="最近更新时间">{{ formatTimestamp(selectedRoom.updatedAt) }}</Descriptions.Item>
            </Descriptions>

            <Row :gutter="12" align="middle" class="mt-4">
              <Col :xs="24" :md="12">
                  <Select
                  v-model:value="activityTimelineFilter"
                  style="width: 100%"
                  :options="[
                    { label: '全部活动', value: 'all' },
                    { label: '连接 / 离线 / 状态', value: 'peer' },
                    { label: '共享实体', value: 'entity' },
                    { label: '管理员动作', value: 'admin' },
                  ]"
                />
              </Col>
              <Col :xs="24" :md="12">
                <Input
                  v-model:value="activityTimelineKeyword"
                  allow-clear
                  placeholder="搜索活动摘要 / 会话 / 用户 / 实体 / 节点"
                />
              </Col>
            </Row>
            <Row :gutter="12" align="middle" class="mt-3">
              <Col :xs="24" :md="12">
                <Tag color="blue">当前筛选：{{ formatActivityFilterLabel(activityTimelineFilter) }}</Tag>
              </Col>
              <Col :xs="24" :md="12">
                <Space wrap class="justify-end w-full">
                  <Button @click="copySelectedRoomSnapshot">
                    复制快照
                  </Button>
                  <Button @click="exportSelectedRoomSnapshot">
                    导出快照
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>

          <Card v-if="selectedRoom" size="small" title="在线连接">
            <Table
              :columns="peerColumns"
              :data-source="selectedRoom.connections"
              :pagination="false"
              row-key="sessionId"
              :scroll="{ x: 1200 }"
            >
              <template #bodyCell="{ column, record: peer }">
                <template v-if="column.key === 'user'">
                  <Space direction="vertical" size="small">
                    <span>{{ formatRuntimeUserLabel(peer) }}</span>
                    <Tag v-if="peer.state" :color="peer.state.subjectType === 'vehicle' ? 'blue' : 'cyan'">
                      {{ formatPeerState(peer.state) }}
                    </Tag>
                  </Space>
                </template>
                <template v-else-if="column.key === 'connectedAt'">
                  {{ formatTimestamp(peer.connectedAt) }}
                </template>
                <template v-else-if="column.key === 'lastActiveAt'">
                  {{ formatTimestamp(peer.lastActiveAt) }}
                </template>
                <template v-else-if="column.key === 'state'">
                  <Space direction="vertical" size="small">
                    <span>{{ formatPeerState(peer.state) }}</span>
                    <span class="multiuser-room-meta">{{ formatPeerStatePosition(peer.state) }}</span>
                  </Space>
                </template>
                <template v-else-if="column.key === 'source'">
                  <Space direction="vertical" size="small">
                    <span>{{ formatRuntimeConnectionSource(peer) }}</span>
                    <span class="multiuser-room-meta">{{ formatRuntimeUserAgent(peer) }}</span>
                  </Space>
                </template>
                <template v-else-if="column.key === 'peerActions'">
                  <Space wrap>
                    <Button size="small" @click="selectPeer(peer)">会话详情</Button>
                    <Button size="small" @click="confirmKickPeer(selectedRoom, peer)">踢连接</Button>
                    <Button size="small" danger @click="confirmKickUser(selectedRoom, peer)">踢用户</Button>
                  </Space>
                </template>
              </template>
            </Table>
          </Card>

          <Card v-if="selectedPeer" size="small" title="会话详情">
            <Descriptions bordered :column="2" size="small">
              <Descriptions.Item label="会话 ID">{{ selectedPeer.sessionId }}</Descriptions.Item>
              <Descriptions.Item label="用户">{{ formatRuntimeUserLabel(selectedPeer) }}</Descriptions.Item>
              <Descriptions.Item label="接入时间">{{ formatTimestamp(selectedPeer.connectedAt) }}</Descriptions.Item>
              <Descriptions.Item label="最近活跃">{{ formatTimestamp(selectedPeer.lastActiveAt) }}</Descriptions.Item>
              <Descriptions.Item label="连接来源" :span="2">
                {{ formatRuntimeConnectionSource(selectedPeer) }}
              </Descriptions.Item>
              <Descriptions.Item label="User-Agent" :span="2">
                <span class="multiuser-room-meta">{{ formatRuntimeUserAgent(selectedPeer) }}</span>
              </Descriptions.Item>
            </Descriptions>

            <Row :gutter="16" class="mt-4">
              <Col :xs="24" :lg="12">
                <Card size="small" title="当前状态">
                  <Descriptions bordered :column="1" size="small">
                    <Descriptions.Item label="主体类型">{{ selectedPeer.state?.subjectType || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="节点 ID">{{ selectedPeer.state?.subjectNodeId || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="标识符">{{ selectedPeer.state?.subjectIdentifier || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="资产 ID">{{ selectedPeer.state?.subjectAssetId || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="资产 URL">{{ selectedPeer.state?.subjectAssetUrl || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="动作">{{ selectedPeer.state?.action || '-' }}</Descriptions.Item>
                    <Descriptions.Item label="位置">
                      {{ formatPeerStatePosition(selectedPeer.state) }}
                    </Descriptions.Item>
                    <Descriptions.Item label="朝向">
                      <span v-if="selectedPeer.state">
                        {{ selectedPeer.state.quaternion.x.toFixed(3) }}, {{ selectedPeer.state.quaternion.y.toFixed(3) }}, {{ selectedPeer.state.quaternion.z.toFixed(3) }}, {{ selectedPeer.state.quaternion.w.toFixed(3) }}
                      </span>
                      <span v-else>-</span>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
              <Col :xs="24" :lg="12">
                <Card size="small" title="同用户其他连接">
                  <Empty v-if="!selectedPeerSiblingConnections.length" description="当前用户只有这一条连接" />
                  <Space v-else direction="vertical" size="small" class="w-full">
                    <Tag v-for="peer in selectedPeerSiblingConnections" :key="peer.sessionId">
                      {{ peer.sessionId }}
                    </Tag>
                  </Space>
                </Card>
              </Col>
            </Row>

            <Card size="small" class="mt-4" title="该用户持有的共享实体">
              <Table
                :columns="entityColumns"
                :data-source="selectedPeerOwnedEntities"
                :pagination="false"
                row-key="entityId"
                :scroll="{ x: 1200 }"
              >
                <template #bodyCell="{ column, record: entity }">
                  <template v-if="column.key === 'nodeId'">
                    {{ entity.state?.nodeId || '-' }}
                  </template>
                  <template v-else-if="column.key === 'ownerUserId'">
                    {{ entity.state?.ownerUserId || '-' }}
                  </template>
                  <template v-else-if="column.key === 'revision'">
                    {{ entity.state?.revision ?? '-' }}
                  </template>
                  <template v-else-if="column.key === 'updatedAt'">
                    {{ formatTimestamp(entity.state?.updatedAt) }}
                  </template>
                  <template v-else-if="column.key === 'position'">
                    <span v-if="entity.state">
                      {{ entity.state.transform.position.x.toFixed(2) }}, {{ entity.state.transform.position.y.toFixed(2) }}, {{ entity.state.transform.position.z.toFixed(2) }}
                    </span>
                    <span v-else>-</span>
                  </template>
                </template>
              </Table>
            </Card>

            <Card size="small" class="mt-4" title="该用户最近活动">
              <Timeline v-if="selectedPeerActivities.length">
                <Timeline.Item v-for="activity in selectedPeerActivities.slice(0, 12)" :key="activity.id">
                  <Space direction="vertical" size="small" class="w-full">
                    <Space wrap>
                      <Tag :color="getActivityTagColor(activity)">{{ formatActivityLabel(activity) }}</Tag>
                      <span class="multiuser-room-meta">{{ formatTimestamp(activity.createdAt) }}</span>
                    </Space>
                    <div>{{ activity.summary }}</div>
                    <div class="multiuser-room-meta">
                      <span v-if="activity.nodeId">节点 {{ activity.nodeId }}</span>
                      <span v-if="activity.nodeId && activity.entityId"> · </span>
                      <span v-if="activity.entityId">实体 {{ activity.entityId }}</span>
                    </div>
                  </Space>
                </Timeline.Item>
              </Timeline>
              <Empty v-else description="当前会话暂无活动记录" />
            </Card>
          </Card>

          <Card v-if="selectedRoom" size="small" title="共享实体">
            <Table
              :columns="entityColumns"
              :data-source="selectedRoom.entities"
              :pagination="false"
              row-key="entityId"
              :scroll="{ x: 1200 }"
            >
              <template #bodyCell="{ column, record: entity }">
                <template v-if="column.key === 'nodeId'">
                  {{ entity.state?.nodeId || '-' }}
                </template>
                <template v-else-if="column.key === 'ownerUserId'">
                  {{ entity.state?.ownerUserId || '-' }}
                </template>
                <template v-else-if="column.key === 'revision'">
                  {{ entity.state?.revision ?? '-' }}
                </template>
                <template v-else-if="column.key === 'updatedAt'">
                  {{ formatTimestamp(entity.state?.updatedAt) }}
                </template>
                <template v-else-if="column.key === 'position'">
                  <span v-if="entity.state">
                    {{ entity.state.transform.position.x.toFixed(2) }}, {{ entity.state.transform.position.y.toFixed(2) }}, {{ entity.state.transform.position.z.toFixed(2) }}
                  </span>
                  <span v-else>-</span>
                </template>
              </template>
            </Table>
          </Card>

          <Card v-if="selectedRoom" size="small" title="房间时间线">
            <Timeline v-if="roomActivities.length">
              <Timeline.Item v-for="activity in roomActivities.slice(0, 16)" :key="activity.id">
                <Space direction="vertical" size="small" class="w-full">
                  <Space wrap>
                    <Tag :color="getActivityTagColor(activity)">{{ formatActivityLabel(activity) }}</Tag>
                    <span class="multiuser-room-meta">{{ formatTimestamp(activity.createdAt) }}</span>
                    <span v-if="activity.displayName" class="multiuser-room-meta">{{ activity.displayName }}</span>
                  </Space>
                  <div>{{ activity.summary }}</div>
                  <div class="multiuser-room-meta">
                    <span v-if="activity.sessionId">会话 {{ activity.sessionId }}</span>
                    <span v-if="activity.sessionId && activity.userId"> · </span>
                    <span v-if="activity.userId">用户 {{ activity.userId }}</span>
                    <span v-if="activity.userId && activity.entityId"> · </span>
                    <span v-if="activity.entityId">实体 {{ activity.entityId }}</span>
                    <span v-if="activity.nodeId && !activity.entityId"> · 节点 {{ activity.nodeId }}</span>
                  </div>
                </Space>
              </Timeline.Item>
            </Timeline>
            <Empty v-else description="当前房间暂无活动记录" />
          </Card>

          <Empty v-else description="选择一个房间后查看详情" />
        </Space>
      </Spin>
    </Drawer>
  </div>
</template>

<style scoped>
.multiuser-dashboard-card {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.92));
  color: #f8fafc;
}

.multiuser-dashboard-card :deep(.ant-card-body) {
  color: inherit;
}

.multiuser-dashboard-header,
.multiuser-room-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.multiuser-dashboard-kicker {
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.7;
}

.multiuser-dashboard-title {
  margin-top: 6px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
}

.multiuser-dashboard-subtitle {
  margin-top: 8px;
  color: rgba(248, 250, 252, 0.78);
}

.multiuser-room-name {
  font-weight: 600;
}

.multiuser-room-id,
.multiuser-room-meta {
  color: rgba(100, 116, 139, 1);
  font-size: 12px;
}
</style>
