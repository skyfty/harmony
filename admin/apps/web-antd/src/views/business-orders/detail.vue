<script setup lang="ts">
import type { BusinessOrderItem } from '#/api';

import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  advanceBusinessOrderProductionApi,
  completeBusinessOrderProductionApi,
  completeBusinessOrderPublishApi,
  getBusinessOrderApi,
  signBusinessOrderApi,
  updateBusinessOrderApi,
} from '#/api';

import { Button, Card, Descriptions, Input, Modal, Space, Spin, Tag, Timeline, message } from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const order = ref<BusinessOrderItem | null>(null);
const notesDraft = ref('');
const contactDraft = ref('');
const productionRemark = ref('');

const currentProductionNode = computed(() => order.value?.productionProgress.find((item) => item.status === 'active') || null);

function stageText(stage?: string) {
  switch (stage) {
    case 'quote':
      return '报价';
    case 'signing':
      return '签约';
    case 'production':
      return '制作';
    case 'publish':
      return '发布';
    case 'operation':
      return '运营';
    default:
      return stage || '-';
  }
}

function stageColor(stage?: string) {
  switch (stage) {
    case 'signing':
      return 'gold';
    case 'production':
      return 'processing';
    case 'publish':
      return 'purple';
    case 'operation':
      return 'success';
    default:
      return 'default';
  }
}

function productionStatusColor(status: string) {
  if (status === 'completed') return 'green';
  if (status === 'active') return 'blue';
  return 'gray';
}

async function loadOrder() {
  const id = String(route.params.id || '');
  if (!id) return;
  loading.value = true;
  try {
    const response = await getBusinessOrderApi(id);
    order.value = response;
    notesDraft.value = response.notes || '';
    contactDraft.value = response.contactPhoneForBusiness || '';
  } finally {
    loading.value = false;
  }
}

async function withSubmit(task: () => Promise<void>) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await task();
  } finally {
    submitting.value = false;
  }
}

async function saveAdminFields() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await updateBusinessOrderApi(id, {
      notes: notesDraft.value,
      contactPhoneForBusiness: contactDraft.value,
    });
    message.success('商务信息已更新');
    await loadOrder();
  });
}

async function signOrder() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await signBusinessOrderApi(id);
    message.success('已完成签约并进入制作阶段');
    await loadOrder();
  });
}

async function advanceProduction() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await advanceBusinessOrderProductionApi(id, productionRemark.value || undefined);
    productionRemark.value = '';
    message.success('制作进度已推进');
    await loadOrder();
  });
}

async function completeProduction() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await completeBusinessOrderProductionApi(id);
    message.success('制作已完成，进入发布阶段');
    await loadOrder();
  });
}

async function completePublish() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await completeBusinessOrderPublishApi(id);
    message.success('发布完成，进入运营阶段');
    await loadOrder();
  });
}

function confirmAction(title: string, action: () => Promise<void>) {
  Modal.confirm({
    title,
    onOk: async () => {
      await action();
    },
  });
}

onMounted(() => {
  void loadOrder();
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card v-if="order" title="商业订单详情">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="text-lg font-semibold">{{ order.scenicName }}</div>
            <div class="text-text-secondary mt-1">{{ order.orderNumber }}</div>
          </div>
          <Button @click="router.back()">返回</Button>
        </div>

        <Descriptions bordered :column="2" size="small">
          <Descriptions.Item label="订单编号">{{ order.orderNumber }}</Descriptions.Item>
          <Descriptions.Item label="当前阶段">
            <Tag :color="stageColor(order.topStage)">{{ stageText(order.topStage) }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="用户">
            {{ order.userInfo?.displayName || order.userInfo?.username || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="签约状态">
            <Tag :color="order.userInfo?.contractStatus === 'signed' ? 'success' : 'default'">
              {{ order.userInfo?.contractStatus === 'signed' ? '已签约' : '未签约' }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="景点类型">{{ order.sceneSpotCategoryName || '-' }}</Descriptions.Item>
          <Descriptions.Item label="景点面积">{{ order.scenicArea ?? '-' }}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{{ order.contactPhone }}</Descriptions.Item>
          <Descriptions.Item label="商务电话">{{ order.contactPhoneForBusiness || '-' }}</Descriptions.Item>
          <Descriptions.Item label="地址" :span="2">{{ order.addressText }}</Descriptions.Item>
          <Descriptions.Item label="特殊景观" :span="2">{{ order.specialLandscapeTags.join('、') || '-' }}</Descriptions.Item>
          <Descriptions.Item label="报价时间">{{ order.quotedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="签约时间">{{ order.signedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="制作开始">{{ order.productionStartedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="制作完成">{{ order.productionCompletedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="待发布时间">{{ order.publishReadyAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="发布时间">{{ order.publishedAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="运营开始">{{ order.operatingAt || '-' }}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{{ order.updatedAt }}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card v-if="order" class="mt-4" title="主流程操作">
        <Space wrap>
          <Button
            type="primary"
            :disabled="order.topStage !== 'signing'"
            :loading="submitting"
            @click="confirmAction('确认签约完成并进入制作阶段吗？', signOrder)"
          >签约完成</Button>
          <Button
            :disabled="order.topStage !== 'production'"
            :loading="submitting"
            @click="confirmAction('确认推进到下一制作节点吗？', advanceProduction)"
          >推进制作节点</Button>
          <Button
            :disabled="order.topStage !== 'production'"
            :loading="submitting"
            @click="confirmAction('确认制作完成并进入发布阶段吗？', completeProduction)"
          >制作完成</Button>
          <Button
            :disabled="order.topStage !== 'publish'"
            :loading="submitting"
            @click="confirmAction('确认发布完成并进入运营阶段吗？', completePublish)"
          >发布完成</Button>
        </Space>

        <div class="mt-4 grid gap-3 md:grid-cols-2">
          <Input v-model:value="productionRemark" :disabled="order.topStage !== 'production'" placeholder="推进制作节点时可附带备注" />
          <div class="text-text-secondary text-sm">
            当前节点：{{ currentProductionNode?.label || '无进行中节点' }}
          </div>
        </div>
      </Card>

      <Card v-if="order" class="mt-4" title="制作时间线">
        <Timeline>
          <Timeline.Item
            v-for="item in order.productionProgress"
            :key="item.code"
            :color="productionStatusColor(item.status)"
          >
            <div class="font-medium">{{ item.label }}</div>
            <div class="text-text-secondary">状态：{{ item.status === 'completed' ? '已完成' : item.status === 'active' ? '进行中' : '待开始' }}</div>
            <div v-if="item.activatedAt" class="text-text-secondary">时间：{{ item.activatedAt }}</div>
            <div v-if="item.remark" class="text-text-secondary">备注：{{ item.remark }}</div>
          </Timeline.Item>
        </Timeline>
      </Card>

      <Card v-if="order" class="mt-4" title="商务信息维护">
        <div class="grid gap-3 md:grid-cols-2">
          <Input v-model:value="contactDraft" placeholder="商务联系电话" />
          <Input v-model:value="notesDraft" placeholder="订单备注" />
        </div>
        <div class="mt-4">
          <Button type="primary" :loading="submitting" @click="saveAdminFields">保存商务信息</Button>
        </div>
      </Card>
    </Spin>
  </div>
</template>