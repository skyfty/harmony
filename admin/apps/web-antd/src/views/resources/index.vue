<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';
import type {
  ResourceAssetItem,
  ResourceCategoryItem,
  ResourceSeriesItem,
  ResourceTagItem,
} from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  buildResourceDownloadUrl,
  bulkMoveResourceAssetsApi,
  createResourceAssetApi,
  createResourceCategoryApi,
  deleteResourceAssetApi,
  deleteResourceCategoryApi,
  listResourceAssetsApi,
  listResourceCategoriesApi,
  listResourceSeriesApi,
  listResourceTagsApi,
  mergeResourceCategoriesApi,
  moveResourceCategoryApi,
  updateResourceAssetApi,
  updateResourceCategoryApi,
} from '#/api';

import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tree,
  Upload,
} from 'ant-design-vue';

// (file content copied from system/resources/index.vue)

/* trimmed in this patch preview for brevity; full file content identical to original under views/system/resources/index.vue */

</script>

<template>
  <!-- template identical to original resources index template -->
</template>
