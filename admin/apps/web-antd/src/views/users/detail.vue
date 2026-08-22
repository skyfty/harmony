<script setup lang="ts">
import type {
  BusinessOrderItem,
  LoginLogItem,
  OrderItem,
  PunchRecordItem,
  TravelRecordItem,
  UserControllableAssetItem,
  UserCouponItem,
  UserItem,
  UserMedalStatusItem,
  UserSkinItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';

import {
  Button,
  Card,
  Descriptions,
  message,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import {
  createUserControllableAssetApi,
  createUserSkinApi,
  deleteUserControllableAssetApi,
  deleteUserSkinApi,
  getUserApi,
  listBusinessOrdersApi,
  listControllableAssetsApi,
  listLoginLogsApi,
  listOrdersApi,
  listPunchRecordsApi,
  listSkinsApi,
  listTravelRecordsApi,
  listUserControllableAssetsApi,
  listUserCouponClaimsApi,
  listUserCouponsApi,
  listUserMedalsApi,
  listUserSkinsApi,
  useUserCouponByAdminApi,
} from '#/api';

const route = useRoute();
const router = useRouter();
const userId = computed(() => String(route.params.id ?? ''));

const loading = ref(false);
const activeTab = ref('punch');
const user = ref<null | UserItem>(null);

function createPagedState<T>(pageSize = 10) {
  return reactive({
    items: [] as T[],
    loaded: false,
    loading: false,
    page: 1,
    pageSize,
    total: 0,
  });
}

const punchState = createPagedState<PunchRecordItem>();
const travelState = createPagedState<TravelRecordItem>();
const loginState = createPagedState<LoginLogItem>();
const medalState = createPagedState<UserMedalStatusItem>();
const orderState = createPagedState<OrderItem>();
const businessOrderState = createPagedState<BusinessOrderItem>();
const couponClaimState = createPagedState<UserCouponItem>();
const couponState = createPagedState<UserCouponItem>();
const skinState = createPagedState<UserSkinItem>();
const controllableAssetState = createPagedState<UserControllableAssetItem>();

const { hasAccessByCodes } = useAccess();
const canViewSkins = hasAccessByCodes(['skin:read']);
const canViewControllableAssets = hasAccessByCodes(['controllableAsset:read']);
const canWriteSkins = hasAccessByCodes(['skin:write']);
const canWriteControllableAssets = hasAccessByCodes([
  'controllableAsset:write',
]);

const displayName = computed(
  () =>
    user.value?.displayName ||
    user.value?.username ||
    user.value?.wxOpenId ||
    userId.value,
);

const punchColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt' },
  { title: '景点', dataIndex: 'scenicTitle', key: 'scenicTitle' },
  { title: '场景', dataIndex: 'sceneName', key: 'sceneName' },
  { title: '车辆', dataIndex: 'vehicleName', key: 'vehicleName' },
  { title: '打卡点', dataIndex: 'nodeName', key: 'nodeName' },
  { title: '来源', dataIndex: 'source', key: 'source' },
];

const travelColumns = [
  { title: '进入时间', dataIndex: 'enterTime', key: 'enterTime' },
  { title: '离开时间', dataIndex: 'leaveTime', key: 'leaveTime' },
  {
    title: '停留时长(秒)',
    dataIndex: 'durationSeconds',
    key: 'durationSeconds',
  },
  { title: '景点', dataIndex: 'scenicTitle', key: 'scenicTitle' },
  { title: '场景', dataIndex: 'sceneName', key: 'sceneName' },
  { title: '车辆', dataIndex: 'vehicleName', key: 'vehicleName' },
  { title: '状态', dataIndex: 'status', key: 'status' },
];

const loginColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt' },
  { title: '动作', dataIndex: 'action', key: 'action' },
  { title: '结果', dataIndex: 'success', key: 'success' },
  { title: 'IP', dataIndex: 'ip', key: 'ip' },
  { title: '设备', dataIndex: 'device', key: 'device' },
  { title: 'User-Agent', dataIndex: 'userAgent', key: 'userAgent' },
  { title: '备注', dataIndex: 'note', key: 'note' },
];

const medalColumns = [
  { title: '勋章名称', dataIndex: 'name', key: 'name' },
  { title: '启用状态', dataIndex: 'enabled', key: 'enabled' },
  { title: '获得状态', dataIndex: 'awarded', key: 'awarded' },
  {
    title: '完成度',
    dataIndex: 'completionRatio',
    key: 'completionRatio',
    width: 180,
  },
  { title: '获得时间', dataIndex: 'awardedAt', key: 'awardedAt' },
  { title: '规则数', dataIndex: 'ruleCount', key: 'ruleCount' },
  { title: '描述', dataIndex: 'description', key: 'description' },
];

const orderColumns = [
  { title: '订单号', dataIndex: 'orderNumber', key: 'orderNumber' },
  { title: '订单状态', dataIndex: 'orderStatus', key: 'orderStatus' },
  { title: '支付状态', dataIndex: 'paymentStatus', key: 'paymentStatus' },
  { title: '退款状态', dataIndex: 'refundStatus', key: 'refundStatus' },
  { title: '金额', dataIndex: 'totalAmount', key: 'totalAmount' },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
  { title: '操作', key: 'actions' },
];

const businessOrderColumns = [
  { title: '订单号', dataIndex: 'orderNumber', key: 'orderNumber' },
  { title: '景点名称', dataIndex: 'scenicName', key: 'scenicName' },
  {
    title: '景点类型',
    dataIndex: 'sceneSpotCategoryName',
    key: 'sceneSpotCategoryName',
  },
  { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone' },
  { title: '当前阶段', dataIndex: 'topStage', key: 'topStage' },
  {
    title: '签约状态',
    dataIndex: ['userInfo', 'contractStatus'],
    key: 'contractStatus',
  },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
  { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt' },
  { title: '操作', key: 'actions' },
];

const couponClaimColumns = [
  { title: '卡券名称', dataIndex: ['coupon', 'title'], key: 'couponTitle' },
  { title: '申请/领取时间', dataIndex: 'claimedAt', key: 'claimedAt' },
  {
    title: '获取方式',
    dataIndex: 'acquisitionSource',
    key: 'acquisitionSource',
  },
  { title: '当前状态', dataIndex: 'status', key: 'status' },
  { title: '过期时间', dataIndex: 'expiresAt', key: 'expiresAt' },
];

const couponColumns = [
  { title: '卡券名称', dataIndex: ['coupon', 'title'], key: 'couponTitle' },
  { title: '状态', dataIndex: 'status', key: 'status' },
  { title: '领取时间', dataIndex: 'claimedAt', key: 'claimedAt' },
  { title: '过期时间', dataIndex: 'expiresAt', key: 'expiresAt' },
  { title: '使用时间', dataIndex: 'usedAt', key: 'usedAt' },
  { title: '操作', key: 'actions' },
];

const skinColumns = [
  { title: '皮肤名称', dataIndex: ['skin', 'name'], key: 'skinName' },
  {
    title: '皮肤标识',
    dataIndex: ['skin', 'identifier'],
    key: 'skinIdentifier',
  },
  {
    title: '皮肤分类',
    dataIndex: ['skin', 'categoryName'],
    key: 'skinCategoryName',
  },
  { title: '获取方式', dataIndex: 'source', key: 'source' },
  { title: '拥有时间', dataIndex: 'acquiredAt', key: 'acquiredAt' },
  { title: '操作', key: 'actions' },
];

const controllableAssetColumns = [
  {
    title: '资产名称',
    dataIndex: ['controllableAsset', 'name'],
    key: 'assetName',
  },
  {
    title: '资产标识',
    dataIndex: ['controllableAsset', 'identifier'],
    key: 'assetIdentifier',
  },
  { title: '类型', dataIndex: ['controllableAsset', 'type'], key: 'assetType' },
  { title: '获取方式', dataIndex: 'source', key: 'source' },
  { title: '是否当前选中', dataIndex: 'isSelected', key: 'isSelected' },
  { title: '拥有时间', dataIndex: 'acquiredAt', key: 'acquiredAt' },
  { title: '操作', key: 'actions' },
];

function formatTabTitle(title: string, total: number, loaded: boolean) {
  return loaded ? `${title} (${total})` : title;
}

function toMedalPercent(ratio?: number) {
  const parsed = Number(ratio ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(parsed * 100)));
}

function getCellValue(
  record: Record<string, any>,
  key: number | readonly (number | string)[] | string | undefined,
) {
  if (Array.isArray(key)) {
    return key.reduce((acc: any, current) => acc?.[current], record);
  }
  if (typeof key === 'string' || typeof key === 'number') {
    return record?.[key];
  }
  return null;
}

function formatCouponAcquisitionSource(source?: null | string) {
  switch (source) {
    case 'admin-batch-distribute': {
      return '后台批量发放';
    }
    case 'admin-distribute': {
      return '后台发放';
    }
    case 'miniapp-claim': {
      return '用户领取';
    }
    default: {
      return '未知';
    }
  }
}

function formatAssetSource(source?: null | string) {
  return source === 'admin-assign' ? '后台发放' : '订单购买';
}

function formatAssetType(type?: null | string) {
  switch (type) {
    case 'aircraft': {
      return '飞行器';
    }
    case 'character': {
      return '人物';
    }
    case 'ship': {
      return '船舶';
    }
    case 'vehicle': {
      return '车辆';
    }
    default: {
      return type || '-';
    }
  }
}

function formatBusinessOrderStage(stage?: null | string) {
  switch (stage) {
    case 'operation': {
      return '运营';
    }
    case 'production': {
      return '制作';
    }
    case 'publish': {
      return '发布';
    }
    case 'quote': {
      return '报价';
    }
    case 'signing': {
      return '签约';
    }
    default: {
      return stage || '-';
    }
  }
}

function getBusinessOrderStageColor(stage?: null | string) {
  switch (stage) {
    case 'operation': {
      return 'success';
    }
    case 'production': {
      return 'processing';
    }
    case 'publish': {
      return 'purple';
    }
    case 'quote': {
      return 'default';
    }
    case 'signing': {
      return 'gold';
    }
    default: {
      return 'default';
    }
  }
}

function goBack() {
  router.back();
}

function openScenicDetail(scenicId?: string) {
  if (!scenicId) return;
  router.push({ name: 'SceneSpotDetail', params: { id: scenicId } });
}

function openOrderDetail(orderId: string) {
  router.push({ name: 'OrderDetail', params: { id: orderId } });
}

function openBusinessOrderDetail(orderId: string) {
  router.push({ name: 'BusinessOrderDetail', params: { id: orderId } });
}

async function loadUser() {
  if (!userId.value) return;
  loading.value = true;
  try {
    user.value = await getUserApi(userId.value);
  } finally {
    loading.value = false;
  }
}

async function loadPunch(
  page = punchState.page,
  pageSize = punchState.pageSize,
) {
  if (!userId.value) return;
  punchState.loading = true;
  try {
    const res = await listPunchRecordsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    punchState.items = res.items || [];
    punchState.total = res.total || 0;
    punchState.page = page;
    punchState.pageSize = pageSize;
    punchState.loaded = true;
  } finally {
    punchState.loading = false;
  }
}

async function loadTravel(
  page = travelState.page,
  pageSize = travelState.pageSize,
) {
  if (!userId.value) return;
  travelState.loading = true;
  try {
    const res = await listTravelRecordsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    travelState.items = res.items || [];
    travelState.total = res.total || 0;
    travelState.page = page;
    travelState.pageSize = pageSize;
    travelState.loaded = true;
  } finally {
    travelState.loading = false;
  }
}

async function loadLogins(
  page = loginState.page,
  pageSize = loginState.pageSize,
) {
  if (!userId.value) return;
  loginState.loading = true;
  try {
    const res = await listLoginLogsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    loginState.items = res.items || [];
    loginState.total = res.total || 0;
    loginState.page = page;
    loginState.pageSize = pageSize;
    loginState.loaded = true;
  } finally {
    loginState.loading = false;
  }
}

async function loadMedals(
  page = medalState.page,
  pageSize = medalState.pageSize,
) {
  if (!userId.value) return;
  medalState.loading = true;
  try {
    const res = await listUserMedalsApi(userId.value, { page, pageSize });
    medalState.items = res.items || [];
    medalState.total = res.total || 0;
    medalState.page = page;
    medalState.pageSize = pageSize;
    medalState.loaded = true;
  } finally {
    medalState.loading = false;
  }
}

async function loadOrders(
  page = orderState.page,
  pageSize = orderState.pageSize,
) {
  if (!userId.value) return;
  orderState.loading = true;
  try {
    const res = await listOrdersApi({ page, pageSize, userId: userId.value });
    orderState.items = res.items || [];
    orderState.total = res.total || 0;
    orderState.page = page;
    orderState.pageSize = pageSize;
    orderState.loaded = true;
  } finally {
    orderState.loading = false;
  }
}

async function loadBusinessOrders(
  page = businessOrderState.page,
  pageSize = businessOrderState.pageSize,
) {
  if (!userId.value) return;
  businessOrderState.loading = true;
  try {
    const res = await listBusinessOrdersApi({
      page,
      pageSize,
      userId: userId.value,
    });
    businessOrderState.items = res.items || [];
    businessOrderState.total = res.total || 0;
    businessOrderState.page = page;
    businessOrderState.pageSize = pageSize;
    businessOrderState.loaded = true;
  } finally {
    businessOrderState.loading = false;
  }
}

async function loadCouponClaims(
  page = couponClaimState.page,
  pageSize = couponClaimState.pageSize,
) {
  if (!userId.value) return;
  couponClaimState.loading = true;
  try {
    const res = await listUserCouponClaimsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    couponClaimState.items = res.items || [];
    couponClaimState.total = res.total || 0;
    couponClaimState.page = page;
    couponClaimState.pageSize = pageSize;
    couponClaimState.loaded = true;
  } finally {
    couponClaimState.loading = false;
  }
}

async function loadCoupons(
  page = couponState.page,
  pageSize = couponState.pageSize,
) {
  if (!userId.value) return;
  couponState.loading = true;
  try {
    const res = await listUserCouponsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    couponState.items = res.items || [];
    couponState.total = res.total || 0;
    couponState.page = page;
    couponState.pageSize = pageSize;
    couponState.loaded = true;
  } finally {
    couponState.loading = false;
  }
}

async function loadSkins(page = skinState.page, pageSize = skinState.pageSize) {
  if (!userId.value) return;
  skinState.loading = true;
  try {
    const res = await listUserSkinsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    skinState.items = res.items || [];
    skinState.total = res.total || 0;
    skinState.page = page;
    skinState.pageSize = pageSize;
    skinState.loaded = true;
  } finally {
    skinState.loading = false;
  }
}

async function loadControllableAssets(
  page = controllableAssetState.page,
  pageSize = controllableAssetState.pageSize,
) {
  if (!userId.value) return;
  controllableAssetState.loading = true;
  try {
    const res = await listUserControllableAssetsApi({
      page,
      pageSize,
      userId: userId.value,
    });
    controllableAssetState.items = res.items || [];
    controllableAssetState.total = res.total || 0;
    controllableAssetState.page = page;
    controllableAssetState.pageSize = pageSize;
    controllableAssetState.loaded = true;
  } finally {
    controllableAssetState.loading = false;
  }
}

const skinAssignOpen = ref(false);
const skinAssignSubmitting = ref(false);
const skinSearchLoading = ref(false);
const skinSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const skinSearchToken = ref(0);
const selectedSkinId = ref<string | undefined>();

const assetAssignOpen = ref(false);
const assetAssignSubmitting = ref(false);
const assetSearchLoading = ref(false);
const assetSearchOptions = ref<Array<{ label: string; value: string }>>([]);
const assetSearchToken = ref(0);
const selectedAssetId = ref<string | undefined>();

async function handleSkinSearch(keyword = '') {
  const token = ++skinSearchToken.value;
  skinSearchLoading.value = true;
  try {
    const res = await listSkinsApi({
      keyword: keyword.trim() || undefined,
      isActive: true,
      page: 1,
      pageSize: 100,
    });
    if (token !== skinSearchToken.value) {
      return;
    }
    skinSearchOptions.value = (res.items || []).map((item) => ({
      label: `${item.name} (${item.identifier})`,
      value: item.id,
    }));
  } finally {
    if (token === skinSearchToken.value) {
      skinSearchLoading.value = false;
    }
  }
}

async function handleAssetSearch(keyword = '') {
  const token = ++assetSearchToken.value;
  assetSearchLoading.value = true;
  try {
    const res = await listControllableAssetsApi({
      keyword: keyword.trim() || undefined,
      isActive: true,
      page: 1,
      pageSize: 100,
    });
    if (token !== assetSearchToken.value) {
      return;
    }
    assetSearchOptions.value = (res.items || []).map((item) => ({
      label: `${item.name} (${item.identifier}) · ${formatAssetType(item.type)}`,
      value: item.id,
    }));
  } finally {
    if (token === assetSearchToken.value) {
      assetSearchLoading.value = false;
    }
  }
}

function openSkinAssignModal() {
  selectedSkinId.value = undefined;
  skinSearchOptions.value = [];
  skinAssignOpen.value = true;
}

function openAssetAssignModal() {
  selectedAssetId.value = undefined;
  assetSearchOptions.value = [];
  assetAssignOpen.value = true;
}

async function submitSkinAssign() {
  if (!selectedSkinId.value) {
    message.error('请选择皮肤');
    return;
  }
  skinAssignSubmitting.value = true;
  try {
    await createUserSkinApi({
      userId: userId.value,
      skinId: selectedSkinId.value,
    });
    message.success('皮肤分配成功');
    skinAssignOpen.value = false;
    await loadSkins(skinState.page, skinState.pageSize);
  } finally {
    skinAssignSubmitting.value = false;
  }
}

async function submitAssetAssign() {
  if (!selectedAssetId.value) {
    message.error('请选择可控资产');
    return;
  }
  assetAssignSubmitting.value = true;
  try {
    await createUserControllableAssetApi({
      userId: userId.value,
      controllableAssetId: selectedAssetId.value,
    });
    message.success('可控资产分配成功');
    assetAssignOpen.value = false;
    await loadControllableAssets(
      controllableAssetState.page,
      controllableAssetState.pageSize,
    );
  } finally {
    assetAssignSubmitting.value = false;
  }
}

async function removeSkin(id: string) {
  await deleteUserSkinApi(id);
  message.success('皮肤已删除');
  await loadSkins(skinState.page, skinState.pageSize);
}

async function removeControllableAsset(id: string) {
  await deleteUserControllableAssetApi(id);
  message.success('可控资产已删除');
  await loadControllableAssets(
    controllableAssetState.page,
    controllableAssetState.pageSize,
  );
}

async function markCouponUsed(userCouponId: string) {
  await useUserCouponByAdminApi(userCouponId);
  message.success('卡券已标记为使用');
  await loadCoupons(couponState.page, couponState.pageSize);
  if (couponClaimState.loaded) {
    await loadCouponClaims(couponClaimState.page, couponClaimState.pageSize);
  }
}

async function ensureActiveTabLoaded(key: string) {
  switch (key) {
    case 'business-order': {
      if (!businessOrderState.loaded) await loadBusinessOrders();
      break;
    }
    case 'controllable-asset': {
      if (!controllableAssetState.loaded) await loadControllableAssets();
      break;
    }
    case 'coupon': {
      if (!couponState.loaded) await loadCoupons();
      break;
    }
    case 'coupon-claim': {
      if (!couponClaimState.loaded) await loadCouponClaims();
      break;
    }
    case 'login': {
      if (!loginState.loaded) await loadLogins();
      break;
    }
    case 'medal': {
      if (!medalState.loaded) await loadMedals();
      break;
    }
    case 'order': {
      if (!orderState.loaded) await loadOrders();
      break;
    }
    case 'skin': {
      if (!skinState.loaded) await loadSkins();
      break;
    }
    case 'travel': {
      if (!travelState.loaded) await loadTravel();
      break;
    }
    case 'punch':
    default: {
      if (!punchState.loaded) await loadPunch();
      break;
    }
  }
}

function handleTabChange(key: number | string) {
  const nextKey = String(key);
  activeTab.value = nextKey;
  void ensureActiveTabLoaded(nextKey);
}

onMounted(async () => {
  await loadUser();
  await ensureActiveTabLoaded(activeTab.value);
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card>
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            gap: 12px;
          "
        >
          <div>
            <div style="font-size: 20px; font-weight: 600">用户详情</div>
            <div class="text-text-secondary" style="margin-top: 4px">
              {{ displayName }}
            </div>
          </div>
          <Button @click="goBack">返回</Button>
        </div>

        <Descriptions bordered size="small" :column="2">
          <Descriptions.Item label="用户ID">
            {{ user?.id || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="用户名">
            {{ user?.username || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="昵称">
            {{ user?.displayName || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag :color="user?.status === 'active' ? 'success' : 'default'">
              {{ user?.status === 'active' ? '启用' : '禁用' }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="签约状态">
            <Tag
              :color="user?.contractStatus === 'signed' ? 'success' : 'default'"
            >
              {{ user?.contractStatus === 'signed' ? '已签约' : '未签约' }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="微信 OpenId">
            {{ user?.wxOpenId || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="微信 UnionId">
            {{ user?.wxUnionId || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="手机号">
            {{ user?.phone || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="邮箱">
            {{ user?.email || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="性别">
            {{ user?.gender || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="生日">
            {{ user?.birthDate || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="登录方式">
            {{ user?.authProvider || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="最后登录来源">
            {{ user?.lastLoginSource || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="最后登录时间">
            {{ user?.lastLoginAt || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="手机号绑定时间">
            {{ user?.phoneBoundAt || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="作品分享次数">
            {{ user?.workShareCount ?? 0 }}
          </Descriptions.Item>
          <Descriptions.Item label="展厅分享次数">
            {{ user?.exhibitionShareCount ?? 0 }}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {{ user?.createdAt || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {{ user?.updatedAt || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="简介" :span="2">
            {{ user?.bio || '-' }}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card class="mt-4">
        <Tabs v-model:active-key="activeTab" @change="handleTabChange">
          <Tabs.TabPane
            key="punch"
            :tab="
              formatTabTitle('打卡记录', punchState.total, punchState.loaded)
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="punchColumns"
              :data-source="punchState.items"
              :loading="punchState.loading"
              :scroll="{ x: 900 }"
              :pagination="{
                current: punchState.page,
                pageSize: punchState.pageSize,
                total: punchState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadPunch(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'createdAt'">
                  {{ record.createdAt || '-' }}
                </template>
                <template v-else-if="column.key === 'scenicTitle'">
                  <Button
                    type="link"
                    size="small"
                    @click="openScenicDetail(record.scenicId)"
                  >
                    {{ record.scenicTitle || record.scenicId || '-' }}
                  </Button>
                </template>
                <template v-else-if="column.key === 'vehicleName'">
                  {{ record.vehicleName || record.vehicleIdentifier || '-' }}
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) || '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="travel"
            :tab="
              formatTabTitle('浏览记录', travelState.total, travelState.loaded)
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="travelColumns"
              :data-source="travelState.items"
              :loading="travelState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: travelState.page,
                pageSize: travelState.pageSize,
                total: travelState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadTravel(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'scenicTitle'">
                  <Button
                    type="link"
                    size="small"
                    @click="openScenicDetail(record.scenicId)"
                  >
                    {{ record.scenicTitle || record.scenicId || '-' }}
                  </Button>
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag
                    :color="
                      record.status === 'completed' ? 'success' : 'processing'
                    "
                  >
                    {{ record.status === 'completed' ? '已完成' : '进行中' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'vehicleName'">
                  {{ record.vehicleName || record.vehicleIdentifier || '-' }}
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="login"
            :tab="
              formatTabTitle(
                '小程序登录记录',
                loginState.total,
                loginState.loaded,
              )
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="loginColumns"
              :data-source="loginState.items"
              :loading="loginState.loading"
              :scroll="{ x: 1100 }"
              :pagination="{
                current: loginState.page,
                pageSize: loginState.pageSize,
                total: loginState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadLogins(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'success'">
                  <Tag :color="record.success ? 'success' : 'error'">
                    {{ record.success ? '成功' : '失败' }}
                  </Tag>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="medal"
            :tab="
              formatTabTitle('勋章状态', medalState.total, medalState.loaded)
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="medalColumns"
              :data-source="medalState.items"
              :loading="medalState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: medalState.page,
                pageSize: medalState.pageSize,
                total: medalState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadMedals(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'enabled'">
                  <Tag :color="record.enabled ? 'success' : 'default'">
                    {{ record.enabled ? '启用' : '停用' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'awarded'">
                  <Tag :color="record.awarded ? 'gold' : 'default'">
                    {{ record.awarded ? '已获得' : '未获得' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'completionRatio'">
                  <div style="min-width: 140px">
                    <div
                      style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 4px;
                        gap: 8px;
                      "
                    >
                      <span>{{ toMedalPercent(record.completionRatio) }}%</span>
                      <Tag :color="record.awarded ? 'gold' : 'blue'">
                        {{ record.awarded ? '已达成' : '进行中' }}
                      </Tag>
                    </div>
                    <Progress
                      :percent="toMedalPercent(record.completionRatio)"
                      :show-info="false"
                      size="small"
                      :stroke-color="record.awarded ? '#d48806' : '#1677ff'"
                    />
                  </div>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="order"
            :tab="
              formatTabTitle(
                '商品支付/订单',
                orderState.total,
                orderState.loaded,
              )
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="orderColumns"
              :data-source="orderState.items"
              :loading="orderState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: orderState.page,
                pageSize: orderState.pageSize,
                total: orderState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadOrders(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'orderNumber'">
                  <Button
                    type="link"
                    size="small"
                    @click="openOrderDetail(record.id)"
                  >
                    {{ record.orderNumber }}
                  </Button>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Button
                    type="link"
                    size="small"
                    @click="openOrderDetail(record.id)"
                  >
                    查看详情
                  </Button>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="business-order"
            :tab="
              formatTabTitle(
                '商业订单',
                businessOrderState.total,
                businessOrderState.loaded,
              )
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="businessOrderColumns"
              :data-source="businessOrderState.items"
              :loading="businessOrderState.loading"
              :scroll="{ x: 1200 }"
              :pagination="{
                current: businessOrderState.page,
                pageSize: businessOrderState.pageSize,
                total: businessOrderState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) =>
                  loadBusinessOrders(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'orderNumber'">
                  <Button
                    type="link"
                    size="small"
                    @click="openBusinessOrderDetail(record.id)"
                  >
                    {{ record.orderNumber || '-' }}
                  </Button>
                </template>
                <template v-else-if="column.key === 'topStage'">
                  <Tag :color="getBusinessOrderStageColor(record.topStage)">
                    {{ formatBusinessOrderStage(record.topStage) }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'contractStatus'">
                  <Tag
                    :color="
                      record.userInfo?.contractStatus === 'signed'
                        ? 'success'
                        : 'default'
                    "
                  >
                    {{
                      record.userInfo?.contractStatus === 'signed'
                        ? '已签约'
                        : '未签约'
                    }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Button
                    type="link"
                    size="small"
                    @click="openBusinessOrderDetail(record.id)"
                  >
                    查看详情
                  </Button>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="coupon-claim"
            :tab="
              formatTabTitle(
                '卡券申请记录',
                couponClaimState.total,
                couponClaimState.loaded,
              )
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="couponClaimColumns"
              :data-source="couponClaimState.items"
              :loading="couponClaimState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: couponClaimState.page,
                pageSize: couponClaimState.pageSize,
                total: couponClaimState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadCouponClaims(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'couponTitle'">
                  {{ record.coupon?.title || '-' }}
                </template>
                <template v-else-if="column.key === 'acquisitionSource'">
                  <Tag color="blue">
                    {{
                      formatCouponAcquisitionSource(record.acquisitionSource)
                    }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag
                    :color="
                      record.status === 'used'
                        ? 'processing'
                        : record.status === 'expired'
                          ? 'default'
                          : 'success'
                    "
                  >
                    {{
                      record.status === 'used'
                        ? '已使用'
                        : record.status === 'expired'
                          ? '已过期'
                          : '未使用'
                    }}
                  </Tag>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="coupon"
            :tab="
              formatTabTitle(
                '卡券使用记录',
                couponState.total,
                couponState.loaded,
              )
            "
          >
            <Table
              size="small"
              row-key="id"
              :columns="couponColumns"
              :data-source="couponState.items"
              :loading="couponState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: couponState.page,
                pageSize: couponState.pageSize,
                total: couponState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadCoupons(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'couponTitle'">
                  {{ record.coupon?.title || '-' }}
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag
                    :color="
                      record.status === 'used'
                        ? 'processing'
                        : record.status === 'expired'
                          ? 'default'
                          : 'success'
                    "
                  >
                    {{
                      record.status === 'used'
                        ? '已使用'
                        : record.status === 'expired'
                          ? '已过期'
                          : '未使用'
                    }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Space>
                    <Popconfirm
                      v-if="record.status === 'unused'"
                      title="确认将此卡券标记为已使用？"
                      @confirm="markCouponUsed(record.id)"
                    >
                      <Button type="link" size="small">标记已使用</Button>
                    </Popconfirm>
                    <span v-else class="text-text-secondary">-</span>
                  </Space>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            v-if="canViewSkins"
            key="skin"
            :tab="formatTabTitle('皮肤', skinState.total, skinState.loaded)"
          >
            <div class="mb-3" style="display: flex; justify-content: flex-end">
              <Button
                v-if="canWriteSkins"
                type="primary"
                @click="openSkinAssignModal"
              >
                分配皮肤
              </Button>
            </div>
            <Table
              size="small"
              row-key="id"
              :columns="skinColumns"
              :data-source="skinState.items"
              :loading="skinState.loading"
              :scroll="{ x: 900 }"
              :pagination="{
                current: skinState.page,
                pageSize: skinState.pageSize,
                total: skinState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) => loadSkins(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'skinName'">
                  {{ record.skin?.name || '-' }}
                </template>
                <template v-else-if="column.key === 'skinIdentifier'">
                  {{ record.skin?.identifier || '-' }}
                </template>
                <template v-else-if="column.key === 'skinCategoryName'">
                  {{ record.skin?.categoryName || '-' }}
                </template>
                <template v-else-if="column.key === 'source'">
                  <Tag
                    :color="
                      record.source === 'admin-assign' ? 'blue' : 'default'
                    "
                  >
                    {{ formatAssetSource(record.source) }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Popconfirm
                    v-if="canWriteSkins"
                    title="确认删除该皮肤？删除后会同时清除当前选中。"
                    @confirm="removeSkin(record.id)"
                  >
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                  <span v-else class="text-text-secondary">-</span>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane
            v-if="canViewControllableAssets"
            key="controllable-asset"
            :tab="
              formatTabTitle(
                '可控资产',
                controllableAssetState.total,
                controllableAssetState.loaded,
              )
            "
          >
            <div class="mb-3" style="display: flex; justify-content: flex-end">
              <Button
                v-if="canWriteControllableAssets"
                type="primary"
                @click="openAssetAssignModal"
              >
                分配可控资产
              </Button>
            </div>
            <Table
              size="small"
              row-key="id"
              :columns="controllableAssetColumns"
              :data-source="controllableAssetState.items"
              :loading="controllableAssetState.loading"
              :scroll="{ x: 1000 }"
              :pagination="{
                current: controllableAssetState.page,
                pageSize: controllableAssetState.pageSize,
                total: controllableAssetState.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, pageSize) =>
                  loadControllableAssets(page, pageSize),
              }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'assetName'">
                  {{ record.controllableAsset?.name || '-' }}
                </template>
                <template v-else-if="column.key === 'assetIdentifier'">
                  {{ record.controllableAsset?.identifier || '-' }}
                </template>
                <template v-else-if="column.key === 'assetType'">
                  <Tag color="processing">
                    {{ formatAssetType(record.controllableAsset?.type) }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'source'">
                  <Tag
                    :color="
                      record.source === 'admin-assign' ? 'blue' : 'default'
                    "
                  >
                    {{ formatAssetSource(record.source) }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'isSelected'">
                  <Tag :color="record.isSelected ? 'gold' : 'default'">
                    {{ record.isSelected ? '当前选中' : '未选中' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <Popconfirm
                    v-if="canWriteControllableAssets"
                    title="确认删除该可控资产？删除后会同时清除当前选中。"
                    @confirm="removeControllableAsset(record.id)"
                  >
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                  <span v-else class="text-text-secondary">-</span>
                </template>
                <template v-else>
                  {{ getCellValue(record, column.dataIndex) ?? '-' }}
                </template>
              </template>
            </Table>
          </Tabs.TabPane>
        </Tabs>
      </Card>

      <Modal
        :open="skinAssignOpen"
        title="分配皮肤"
        :confirm-loading="skinAssignSubmitting"
        ok-text="分配"
        cancel-text="取消"
        destroy-on-close
        @cancel="() => (skinAssignOpen = false)"
        @ok="submitSkinAssign"
      >
        <div class="text-text-secondary mb-3">
          分配给用户：{{ displayName }}
        </div>
        <Select
          v-model:value="selectedSkinId"
          :filter-option="false"
          :loading="skinSearchLoading"
          :options="skinSearchOptions"
          show-search
          style="width: 100%"
          placeholder="输入皮肤名称/标识搜索"
          @focus="() => handleSkinSearch()"
          @search="handleSkinSearch"
        />
      </Modal>

      <Modal
        :open="assetAssignOpen"
        title="分配可控资产"
        :confirm-loading="assetAssignSubmitting"
        ok-text="分配"
        cancel-text="取消"
        destroy-on-close
        @cancel="() => (assetAssignOpen = false)"
        @ok="submitAssetAssign"
      >
        <div class="text-text-secondary mb-3">
          分配给用户：{{ displayName }}
        </div>
        <Select
          v-model:value="selectedAssetId"
          :filter-option="false"
          :loading="assetSearchLoading"
          :options="assetSearchOptions"
          show-search
          style="width: 100%"
          placeholder="输入资产名称/标识搜索"
          @focus="() => handleAssetSearch()"
          @search="handleAssetSearch"
        />
      </Modal>
    </Spin>
  </div>
</template>
