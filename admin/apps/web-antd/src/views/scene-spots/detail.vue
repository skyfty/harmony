<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import type { SceneSpotItem } from '#/api';
import { getSceneSpotApi } from '#/api';

import { Button, Card, Descriptions, Image, Space, Tag } from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const id = String(route.params.id ?? '');

const loading = ref(true);
const sceneSpot = ref<null | SceneSpotItem>(null);

async function load() {
  loading.value = true;
  try {
    sceneSpot.value = await getSceneSpotApi(id);
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.back();
}

onMounted(load);
</script>

<template>
  <div class="p-5">
    <Card :loading="loading">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">{{ t('page.sceneSpots.detail.title') }}</h3>
        <Space>
          <Button type="default" @click="goBack">{{ t('page.sceneSpots.detail.button.back') }}</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.id')">{{ sceneSpot?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.title')">{{ sceneSpot?.title || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.sceneId')">{{ sceneSpot?.sceneId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="场景打卡点总数">{{ sceneSpot?.sceneCheckpointTotal ?? 0 }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.description')">{{ sceneSpot?.description || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.address')">{{ sceneSpot?.address || '-' }}</Descriptions.Item>
        <Descriptions.Item label="距离">{{ sceneSpot?.distance || '-' }}</Descriptions.Item>
        <Descriptions.Item label="电话">{{ sceneSpot?.phone || '-' }}</Descriptions.Item>
        <Descriptions.Item label="坐标">{{ sceneSpot?.location ? (sceneSpot.location.lat + ', ' + sceneSpot.location.lng) : '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.order')">{{ sceneSpot?.order ?? '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.averageRating')">{{ sceneSpot?.averageRating ?? '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.ratingCount')">{{ sceneSpot?.ratingCount ?? '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.favoriteCount')">{{ sceneSpot?.favoriteCount ?? '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.isFeatured')">
          <Tag :color="sceneSpot?.isFeatured ? 'green' : 'default'">
            {{ sceneSpot?.isFeatured ? t('page.sceneSpots.detail.fields.isFeaturedYes') : t('page.sceneSpots.detail.fields.isFeaturedNo') }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.coverImage')">
          <Image v-if="sceneSpot?.coverImage" :src="sceneSpot.coverImage" :width="160" />
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.slides')">
          <Space v-if="sceneSpot?.slides?.length" wrap>
            <Image
              v-for="(slide, index) in sceneSpot.slides"
              :key="`${slide}-${index}`"
              :src="slide"
              :width="120"
            />
          </Space>
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.createdAt')">{{ sceneSpot?.createdAt || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.sceneSpots.detail.fields.updatedAt')">{{ sceneSpot?.updatedAt || '-' }}</Descriptions.Item>
      </Descriptions>
    </Card>
  </div>
</template>
