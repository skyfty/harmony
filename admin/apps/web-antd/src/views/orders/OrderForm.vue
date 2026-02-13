<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';
import { reactive, ref, watch } from 'vue';
import { Button, Form, Input, InputNumber, Select, AutoComplete, Space, message, Avatar } from 'ant-design-vue';
import { listProductsApi, listUsersApi } from '#/api';
import { requestClient } from '#/api/request';
import { h } from 'vue';

const props = defineProps<{ model: any; mode: 'edit' | 'create' }>();
const emit = defineEmits(['submit', 'cancel']);

const formRef = ref<FormInstance>();

const localModel = reactive({
  userId: props.model?.userId || '',
  paymentMethod: props.model?.paymentMethod || '',
  shippingAddress: props.model?.shippingAddress || '',
  status: props.model?.status || 'pending',
  items: (props.model?.items || []).map((it: any) => ({
    productId: it.productId || '',
    name: it.name || '',
    price: it.price ?? 0,
    quantity: it.quantity ?? 1,
  })),
});

// product search options
const productOptions = ref<Array<{ label: string; value: string; price?: number }>>([]);
async function searchProducts(keyword: string) {
  try {
    const res = await listProductsApi({ keyword, page: 1, pageSize: 20 });
    productOptions.value = (res.items || []).map((p: any) => ({ label: p.name, value: p.id, price: p.price }));
  } catch (err) {
    // ignore
  }
}

// user search helper - build rich option labels (with avatar & bio)
const userOptions = ref<Array<{ label: any; value: string; raw?: any }>>([]);
let userSearchToken = 0;
async function searchUsers(keyword: string) {
  const token = ++userSearchToken;
  try {
    const res = await listUsersApi({ keyword, page: 1, pageSize: 10 });
    if (token !== userSearchToken) return;
    const items = (res && (res as any).items) || [];
    userOptions.value = items.map((u: any) => {
      const label = h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        u.avatarUrl
          ? h('img', { src: u.avatarUrl, style: 'width:32px;height:32px;border-radius:50%;object-fit:cover' })
          : h(Avatar, { size: 32, style: { background: '#ddd' }, children: (u.displayName || u.username || '').charAt(0).toUpperCase() }),
        h('div', { style: 'display:flex;flex-direction:column' }, [
          h('div', { style: 'font-weight:500' }, u.displayName || u.username || ''),
          h('div', { style: 'font-size:12px;color:#888' }, u.bio || u.email || ''),
        ]),
      ]);
      return { label, value: u.id, raw: u };
    });
  } catch (err) {
    // ignore
  }
}

function addEmptyItem() {
  localModel.items.push({ productId: '', name: '', price: 0, quantity: 1 });
}

function removeItem(index: number) {
  localModel.items.splice(index, 1);
}

function onSelectProduct(index: number, productId: string) {
  const opt = productOptions.value.find((o) => o.value === productId);
  if (!opt) return;
  const row = localModel.items[index];
  row.productId = productId;
  row.name = opt.label;
  row.price = opt.price ?? row.price;
}

async function submit() {
  try {
    await formRef.value?.validate();
  } catch (err) {
    return;
  }
  if (!localModel.userId) {
    message.error('请选择用户');
    return;
  }
  if (!localModel.items.length) {
    message.error('请至少添加一个商品项');
    return;
  }
  const payload = {
    userId: localModel.userId,
    paymentMethod: localModel.paymentMethod || undefined,
    shippingAddress: localModel.shippingAddress || undefined,
    status: localModel.status,
    items: localModel.items.map((it: any) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity })),
  };
  emit('submit', payload);
}

function cancel() {
  emit('cancel');
}

// keep productOptions in sync when editing existing items: preload their ids
watch(
  () => props.model,
  async (m) => {
    if (!m || !Array.isArray(m.items)) return;
    const ids = Array.from(new Set(m.items.map((it: any) => it.productId).filter(Boolean)));
    if (!ids.length) return;
    try {
      const res = await requestClient.get('/admin/products', { params: { page: 1, pageSize: ids.length } });
      const products = (res && (res as any).data) || [];
      productOptions.value = products.map((p: any) => ({ label: p.name, value: p.id, price: p.price }));
    } catch (err) {
      // ignore
    }
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <Form ref="formRef" :model="localModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
      <Form.Item label="用户" name="userId" :rules="[{ required: true, message: '请选择用户' }]">
        <AutoComplete v-model:value="localModel.userId" :options="userOptions" placeholder="搜索用户（用户名/显示名）" @search="searchUsers" />
        <div v-if="localModel.userId" style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <template v-if="(userOptions.find(u => u.value === localModel.userId) && userOptions.find(u => u.value === localModel.userId).raw)">
            <img v-if="userOptions.find(u => u.value === localModel.userId).raw.avatarUrl" :src="userOptions.find(u => u.value === localModel.userId).raw.avatarUrl" style="width:40px;height:40px;border-radius:50%;object-fit:cover" />
            <div style="display:flex;flex-direction:column">
              <div style="font-weight:600">{{ userOptions.find(u => u.value === localModel.userId).raw.displayName || userOptions.find(u => u.value === localModel.userId).raw.username }}</div>
              <div style="font-size:12px;color:#888">{{ userOptions.find(u => u.value === localModel.userId).raw.bio || userOptions.find(u => u.value === localModel.userId).raw.email }}</div>
            </div>
          </template>
        </div>
      </Form.Item>

      <Form.Item label="状态" name="status">
        <Select v-model:value="localModel.status" :options="[{label:'pending',value:'pending'},{label:'paid',value:'paid'},{label:'completed',value:'completed'},{label:'cancelled',value:'cancelled'}]" />
      </Form.Item>

      <Form.Item label="支付方式" name="paymentMethod">
        <Input v-model:value="localModel.paymentMethod" />
      </Form.Item>

      <Form.Item label="收货地址" name="shippingAddress">
        <Input v-model:value="localModel.shippingAddress" />
      </Form.Item>

      <Form.Item label="商品项">
        <div v-for="(it, idx) in localModel.items" :key="idx" style="margin-bottom:8px">
          <Space>
            <Select style="width:360px" v-model:value="it.productId" show-search :options="productOptions" @search="searchProducts" placeholder="搜索并选择商品" @change="(val) => onSelectProduct(idx, val)" />
            <Input style="width:280px" v-model:value="it.name" placeholder="商品名称（可编辑）" />
            <InputNumber style="width:120px" v-model:value="it.price" min="0" />
            <InputNumber style="width:100px" v-model:value="it.quantity" min="1" />
            <Button type="text" danger @click="() => removeItem(idx)">删除</Button>
          </Space>
        </div>
        <div style="margin-top:8px">
          <Button type="dashed" @click="addEmptyItem">添加商品</Button>
        </div>
      </Form.Item>

      <Form.Item>
        <Button type="primary" @click="submit">保存</Button>
        <Button style="margin-left:8px" @click="cancel">取消</Button>
      </Form.Item>
    </Form>
  </div>
</template>
