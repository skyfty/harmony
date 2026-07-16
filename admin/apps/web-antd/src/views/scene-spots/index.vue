<script setup lang="ts">
import type { FormInstance, UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';
import type { SceneItem, SceneSpotItem } from '#/api';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createSceneSpotApi,
  deleteSceneSpotApi,
  getSceneSpotApi,
  listSceneSpotsApi,
  listScenesApi,
  listSceneSpotCategoriesApi,
  updateSceneSpotApi,
} from '#/api';
import { uploadFileApi } from '#/api/core/file-uploads';
import { apiURL } from '#/api/request';
import { $t } from '#/locales';

import { Button, Form, Input, InputNumber, message, Modal, Select, Space, Switch, TreeSelect, Upload, Tooltip, Tabs } from 'ant-design-vue';
import { EyeOutlined, CommentOutlined, EditOutlined, DeleteOutlined, StarOutlined, FireOutlined, QrcodeOutlined, LinkOutlined } from '@ant-design/icons-vue';

interface SceneSpotFormModel {
  sceneId: string;
  title: string;
  description: string;
  address: string;
  distance: string;
  phone: string;
  locationText: string;
  locationLat?: number;
  locationLng?: number;
  order: number;
  isHome: boolean;
  isFeatured: boolean;
  isHot: boolean;
  averageRating: number;
  ratingCount: number;
  favoriteCount: number;
  categoryId?: string | null;
}
 

const { TextArea } = Input;
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never);
const router = useRouter();

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const sceneSpotFormRef = ref<FormInstance>();

const coverImageFileList = ref<UploadFile[]>([]);
const slidesFileList = ref<UploadFile[]>([]);
const originalCoverImageUrl = ref('');
const originalSlides = ref<string[]>([]);
const previewVisible = ref(false);
const previewImage = ref('');
const previewTitle = ref('');
const wechatQRCodeModalOpen = ref(false);
const wechatQRCodeLoadingRowId = ref<null | string>(null);
const wechatQRCodeActiveTab = ref('wechat-rule-link');
const wechatQRCodeValue = ref('');
const wechatUrlSchemeValue = ref('');
const wechatMiniProgramPathValue = ref('');
const wechatDecodedQueryValue = ref('');

const sceneOptions = ref<Array<{ label: string; value: string }>>([]);
const sceneNameMap = ref<Record<string, string>>({});
const sceneOptionsLoading = ref(false);
const sceneSearchKeyword = ref('');
const sceneOptionsPage = ref(1);
const sceneOptionsPageSize = 20;
const sceneOptionsHasMore = ref(true);
let sceneSearchTimer: null | ReturnType<typeof setTimeout> = null;

const sceneSpotFormModel = reactive<SceneSpotFormModel>({
  sceneId: '',
  title: '',
  description: '',
  distance: '',
  address: '',
  phone: '',
  locationText: '',
  locationLat: undefined,
  locationLng: undefined,
  order: 0,
  isHome: false,
  isFeatured: false,
  isHot: false,
  averageRating: 0,
  ratingCount: 0,
  favoriteCount: 0,
  categoryId: undefined,
});

interface CategoryTreeNode {
  title: string;
  value: string;
  key: string;
  children?: CategoryTreeNode[];
}

const categoryTreeData = ref<CategoryTreeNode[]>([]);
const categoryOptionsLoading = ref(false);

const homeLoading = reactive<Record<string, boolean>>({});
const homeError = reactive<Record<string, boolean>>({});

const modalTitle = computed(() =>
  editingId.value ? t('page.sceneSpots.index.modal.edit') : t('page.sceneSpots.index.modal.create'),
);

const wechatQRCodeModalTitle = computed(() => t('page.sceneSpots.index.wechatQr.modal.title'));
const currentWechatQRCodeValue = computed(() =>
  wechatQRCodeActiveTab.value === 'plain-url-scheme'
    ? wechatUrlSchemeValue.value
    : wechatQRCodeActiveTab.value === 'mini-program-path'
      ? wechatMiniProgramPathValue.value
      : wechatQRCodeValue.value,
);

const WECHAT_MINI_PROGRAM_APP_ID = 'wxbee5b017bdf26cc1';
const WECHAT_MINI_PROGRAM_SCENERY_PATH = 'pages/scenery/index';
const DEFAULT_VEHICLE_IDENTIFIER = 'car1';
const WECHAT_QR_RULE_LINK_BASE = 'https://v.touchmagic.cn';
const BAIDU_MAP_GETPOINT_URL = 'https://lbsyun.baidu.com/maptool/getpoint';

function buildScenePackageDownloadUrl(sceneId: string): string {
  const base = apiURL.replace(/\/+$/u, '')
  return `${base}/mini/scenes/${encodeURIComponent(sceneId)}/package`
}

function formatLocationText(lng?: number, lat?: number) {
  if (lng == null || lat == null) {
    return '';
  }

  const normalizedLng = Number(lng);
  const normalizedLat = Number(lat);
  if (!Number.isFinite(normalizedLng) || !Number.isFinite(normalizedLat)) {
    return '';
  }

  return `${normalizedLng},${normalizedLat}`;
}

function parseLocationText(value: string) {
  const normalized = value
    .trim()
    .replace(/\uFF0C/gu, ',')
    .replace(/\s+/gu, '');

  if (!normalized) {
    return null;
  }

  const parts = normalized.split(',');
  if (parts.length !== 2) {
    return null;
  }

  const [lngText, latText] = parts;
  const lng = Number(lngText);
  const lat = Number(latText);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return {
    lat,
    lng,
    text: `${lng},${lat}`,
  };
}

function openBaiduMapGetPoint() {
  window.open(BAIDU_MAP_GETPOINT_URL, '_blank', 'noopener,noreferrer');
}

const uploadProps: UploadProps = {
  accept: 'image/*',
  beforeUpload: () => false,
};

// Validation rules for upload fields that rely on file lists
const coverImageRules = [
  {
    validator: () => {
      if (coverImageFileList.value.length > 0 || originalCoverImageUrl.value) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(t('page.sceneSpots.index.formFields.coverImage.required')));
    },
  },
];

const slidesRules = [
  {
    validator: () => {
      if (slidesFileList.value.length > 0 || (originalSlides.value && originalSlides.value.length > 0)) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(t('page.sceneSpots.index.formFields.slides.required')));
    },
  },
];

const MAX_SLIDES_COUNT = 10;
const COVER_IMAGE_WIDTH = 256;
const COVER_IMAGE_HEIGHT = 256;
const SLIDE_IMAGE_RECOMMENDED_WIDTH = 750;
const SLIDE_IMAGE_RECOMMENDED_HEIGHT = 422;
const SLIDE_IMAGE_ASPECT_RATIO = 16 / 9;
const SLIDE_IMAGE_RATIO_TOLERANCE = 0.02;

function resetForm() {
  sceneSpotFormModel.sceneId = '';
  sceneSpotFormModel.title = '';
  sceneSpotFormModel.description = '';
  sceneSpotFormModel.distance = '';
  sceneSpotFormModel.address = '';
  sceneSpotFormModel.phone = '';
  sceneSpotFormModel.locationText = '';
  sceneSpotFormModel.locationLat = undefined;
  sceneSpotFormModel.locationLng = undefined;
  sceneSpotFormModel.order = 0;
  sceneSpotFormModel.isHome = false;
  sceneSpotFormModel.averageRating = 0;
  sceneSpotFormModel.ratingCount = 0;
  sceneSpotFormModel.favoriteCount = 0;
  sceneSpotFormModel.categoryId = undefined;
  coverImageFileList.value = [];
  slidesFileList.value = [];
  originalCoverImageUrl.value = '';
  originalSlides.value = [];
}

async function loadCategoryOptions() {
  if (categoryOptionsLoading.value) return;
  categoryOptionsLoading.value = true;
  try {
    const res = await listSceneSpotCategoriesApi();
    const items = Array.isArray(res) ? res.filter((it: any) => it.enabled !== false) : [];
    const byParent = new Map<string | null, any[]>();

    for (const item of items) {
      const parentId = item.parentId ?? null;
      const bucket = byParent.get(parentId) ?? [];
      bucket.push(item);
      byParent.set(parentId, bucket);
    }

    const sortNodes = (nodes: any[]) =>
      nodes
        .slice()
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));

    const buildTree = (parentId: string | null): CategoryTreeNode[] =>
      sortNodes(byParent.get(parentId) ?? []).map((item) => {
        const children = buildTree(item.id);
        return {
          title: item.name,
          value: item.id,
          key: item.id,
          ...(children.length ? { children } : {}),
        };
      });

    categoryTreeData.value = buildTree(null);
  } finally {
    categoryOptionsLoading.value = false;
  }
}

function generateUid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFileUrl(file?: UploadFile): string {
  if (!file) {
    return '';
  }
  return ((file.response as any)?.url || file.url || '') as string;
}

async function uploadSceneSpotResourceFile(file: File, label: string): Promise<string> {
  const payload = new FormData();
  payload.append('file', file);
  payload.append('module', 'scene-spot');
  payload.append('label', label);
  const uploaded = await uploadFileApi(payload);
  return uploaded.url;
}

async function validateImageSize(file: File, width: number, height: number): Promise<boolean> {
  return await new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const ok = img.width === width && img.height === height;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    } catch {
      resolve(false);
    }
  });
}

async function validateImageAspectRatio(file: File, aspectRatio: number, tolerance = 0.02): Promise<boolean> {
  return await new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const ok = img.width > 0 && img.height > 0 && Math.abs(img.width / img.height - aspectRatio) <= tolerance;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    } catch {
      resolve(false);
    }
  });
}

async function handleCoverImageChange(info: UploadChangeParam<UploadFile<any>>) {
  const list = info.fileList.slice(-1);
  if (list.length > 0) {
    const fileObj = list[0]?.originFileObj as File | undefined;
    if (fileObj) {
      const ok = await validateImageSize(fileObj, COVER_IMAGE_WIDTH, COVER_IMAGE_HEIGHT);
      if (!ok) {
        message.error(t('page.sceneSpots.index.error.coverImageSize', { width: COVER_IMAGE_WIDTH, height: COVER_IMAGE_HEIGHT }));
        return;
      }
    }
  }
  coverImageFileList.value = list;
}

async function handleSlidesChange(info: UploadChangeParam<UploadFile<any>>) {
  const list = info.fileList.slice(0, MAX_SLIDES_COUNT);
  const validated: UploadFile[] = [];
  for (const f of list) {
    const fileObj = f.originFileObj as File | undefined;
    if (fileObj) {
      const ok = await validateImageAspectRatio(fileObj, SLIDE_IMAGE_ASPECT_RATIO, SLIDE_IMAGE_RATIO_TOLERANCE);
      if (!ok) {
        message.error(
          t('page.sceneSpots.index.error.slideImageSize', {
            width: SLIDE_IMAGE_RECOMMENDED_WIDTH,
            height: SLIDE_IMAGE_RECOMMENDED_HEIGHT,
            ratio: '16:9',
          }),
        );
        continue;
      }
    }
    validated.push(f);
  }
  slidesFileList.value = validated;
}

async function handlePreview(file: UploadFile) {
  if (!file.url && !file.preview && file.originFileObj) {
    file.preview = URL.createObjectURL(file.originFileObj as File);
  }
  previewImage.value = getFileUrl(file) || String(file.preview || '');
  previewVisible.value = true;
  previewTitle.value = file.name || t('page.sceneSpots.index.formFields.coverImage.label');
}

function mergeSceneOptions(items: SceneItem[], reset: boolean) {
  const mapped = items.map((item) => ({ label: item.name, value: item.id }));
  if (reset) {
    sceneOptions.value = mapped;
  } else {
    const existing = new Set(sceneOptions.value.map((option: { label: string; value: string }) => option.value));
    sceneOptions.value = [...sceneOptions.value, ...mapped.filter((option) => !existing.has(option.value))];
  }

  items.forEach((item) => {
    sceneNameMap.value[item.id] = item.name;
  });
}

async function loadSceneOptions(reset = true) {
  if (sceneOptionsLoading.value) {
    return;
  }
  if (!reset && !sceneOptionsHasMore.value) {
    return;
  }

  sceneOptionsLoading.value = true;
  try {
    const nextPage = reset ? 1 : sceneOptionsPage.value + 1;
    const response = await listScenesApi({
      keyword: sceneSearchKeyword.value || undefined,
      page: nextPage,
      pageSize: sceneOptionsPageSize,
    });

    const items = (response.items || []) as SceneItem[];
    mergeSceneOptions(items, reset);
    sceneOptionsPage.value = nextPage;
    sceneOptionsHasMore.value = sceneOptions.value.length < response.total;
  } finally {
    sceneOptionsLoading.value = false;
  }
}

function handleSceneSearch(keyword: string) {
  if (sceneSearchTimer) {
    clearTimeout(sceneSearchTimer);
  }

  sceneSearchTimer = setTimeout(() => {
    sceneSearchKeyword.value = keyword.trim();
    loadSceneOptions(true);
  }, 250);
}

function handleScenePopupScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (!target) {
    return;
  }

  const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 12;
  if (nearBottom) {
    loadSceneOptions(false);
  }
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: SceneSpotItem) {
  editingId.value = row.id;
  const data = await getSceneSpotApi(row.id);
  sceneSpotFormModel.sceneId = data.sceneId || '';
  sceneSpotFormModel.title = data.title || '';
  sceneSpotFormModel.description = data.description ?? '';
  sceneSpotFormModel.distance = data.distance ?? '';
  sceneSpotFormModel.address = data.address ?? '';
  sceneSpotFormModel.order = data.order ?? 0;
  sceneSpotFormModel.isHome = data.isHome === true;
  sceneSpotFormModel.averageRating = Number(data.averageRating ?? 0);
  sceneSpotFormModel.ratingCount = Number(data.ratingCount ?? 0);
  sceneSpotFormModel.favoriteCount = Number(data.favoriteCount ?? 0);
  sceneSpotFormModel.phone = data.phone ?? '';
  sceneSpotFormModel.locationLat = data.location?.lat ?? undefined;
  sceneSpotFormModel.locationLng = data.location?.lng ?? undefined;
  sceneSpotFormModel.locationText = formatLocationText(sceneSpotFormModel.locationLng, sceneSpotFormModel.locationLat);
  sceneSpotFormModel.categoryId = data.categoryId ?? undefined;
  originalCoverImageUrl.value = data.coverImage || '';
  originalSlides.value = [...(data.slides || [])];

  coverImageFileList.value = data.coverImage
    ? [
        {
          uid: generateUid('cover'),
          name: 'cover-image',
          status: 'done',
          url: data.coverImage,
        },
      ]
    : [];

  slidesFileList.value = (data.slides || []).map((slideUrl: string, index: number) => ({
    uid: generateUid(`slide-${index}`),
    name: `slide-${index + 1}`,
    status: 'done',
    url: slideUrl,
  }));

  modalOpen.value = true;
}

function openDetail(row: SceneSpotItem) {
  router.push({
    name: 'SceneSpotDetail',
    params: { id: row.id },
  });
}

function openComments(row: SceneSpotItem) {
  router.push({
    name: 'SceneSpotCommentsBySceneSpot',
    params: { sceneSpotId: row.id },
  });
}

function buildWechatQRCodeQuery(scenePackageUrl: string, row: SceneSpotItem) {
  return `packageUrl=${encodeURIComponent(scenePackageUrl)}&sceneSpotId=${encodeURIComponent(row.id)}&sceneId=${encodeURIComponent(row.sceneId)}&scenicTitle=${encodeURIComponent(row.title)}&vehicleIdentifier=${encodeURIComponent(DEFAULT_VEHICLE_IDENTIFIER)}`;
}

function buildWechatQRCodeLink(scenePackageUrl: string, row: SceneSpotItem) {
  return `${WECHAT_QR_RULE_LINK_BASE}?${buildWechatQRCodeQuery(scenePackageUrl, row)}`;
}

function buildWechatUrlScheme(scenePackageUrl: string, row: SceneSpotItem) {
  const query = buildWechatQRCodeQuery(scenePackageUrl, row);
  return `weixin://dl/business/?appid=${WECHAT_MINI_PROGRAM_APP_ID}&path=${WECHAT_MINI_PROGRAM_SCENERY_PATH}&query=${encodeURIComponent(query)}&env_version=release`;
}

function buildWechatMiniProgramPath(scenePackageUrl: string, row: SceneSpotItem) {
  return `${WECHAT_MINI_PROGRAM_SCENERY_PATH}?${buildWechatQRCodeQuery(scenePackageUrl, row)}`;
}

function closeWechatQRCodeModal() {
  wechatQRCodeModalOpen.value = false;
  wechatQRCodeActiveTab.value = 'wechat-rule-link';
  wechatQRCodeValue.value = '';
  wechatUrlSchemeValue.value = '';
  wechatMiniProgramPathValue.value = '';
  wechatDecodedQueryValue.value = '';
}

async function copyWechatQRCodeLink() {
  const value = currentWechatQRCodeValue.value.trim();
  if (!value) {
    message.warning(t('page.sceneSpots.index.wechatQr.message.empty'));
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    message.success(t('page.sceneSpots.index.wechatQr.message.copySuccess'));
  } catch {
    message.error(t('page.sceneSpots.index.wechatQr.message.copyFailed'));
  }
}

async function openWechatQRCode(row: SceneSpotItem) {
  if (wechatQRCodeLoadingRowId.value) {
    return;
  }

  wechatQRCodeLoadingRowId.value = row.id;
  try {
    const scenePackageUrl = buildScenePackageDownloadUrl(row.sceneId);
    const query = buildWechatQRCodeQuery(scenePackageUrl, row);
    wechatDecodedQueryValue.value = query;
    wechatQRCodeValue.value = buildWechatQRCodeLink(scenePackageUrl, row);
    wechatUrlSchemeValue.value = buildWechatUrlScheme(scenePackageUrl, row);
    wechatMiniProgramPathValue.value = buildWechatMiniProgramPath(scenePackageUrl, row);
    wechatQRCodeActiveTab.value = 'wechat-rule-link';
    wechatQRCodeModalOpen.value = true;
  } finally {
    if (wechatQRCodeLoadingRowId.value === row.id) {
      wechatQRCodeLoadingRowId.value = null;
    }
  }
}


async function submitSceneSpot() {
  const form = sceneSpotFormRef.value;
  if (!form) {
    return;
  }
  await form.validate();

  const parsedLocation = parseLocationText(sceneSpotFormModel.locationText);
  if (parsedLocation) {
    sceneSpotFormModel.locationText = parsedLocation.text;
    sceneSpotFormModel.locationLng = parsedLocation.lng;
    sceneSpotFormModel.locationLat = parsedLocation.lat;
  }

  const payload = new FormData();
  payload.append('sceneId', sceneSpotFormModel.sceneId);
  payload.append('title', sceneSpotFormModel.title.trim());
  payload.append('description', sceneSpotFormModel.description.trim());
  payload.append('address', sceneSpotFormModel.address.trim());
  payload.append('order', String(Number(sceneSpotFormModel.order) || 0));
  payload.append('isHome', String(sceneSpotFormModel.isHome));
  payload.append('averageRating', String(Number(sceneSpotFormModel.averageRating) || 0));
  payload.append('ratingCount', String(Number(sceneSpotFormModel.ratingCount) || 0));
  payload.append('favoriteCount', String(Number(sceneSpotFormModel.favoriteCount) || 0));
  payload.append('distance', sceneSpotFormModel.distance.trim());
  if (sceneSpotFormModel.phone) {
    payload.append('phone', String(sceneSpotFormModel.phone).trim())
  }
  if (parsedLocation) {
    payload.append('locationLat', String(sceneSpotFormModel.locationLat))
    payload.append('locationLng', String(sceneSpotFormModel.locationLng))
  }

  if (sceneSpotFormModel.categoryId) {
    payload.append('category', String(sceneSpotFormModel.categoryId));
  } else if (editingId.value) {
    // explicit unset when editing and no category selected
    payload.append('category', '');
  }

  const finalSlideUrls: string[] = [];
  const cover = coverImageFileList.value[0];
  if (cover?.originFileObj) {
    const uploadedCoverUrl = await uploadSceneSpotResourceFile(cover.originFileObj as File, `scene-spot-cover-${sceneSpotFormModel.title.trim() || 'image'}`);
    payload.append('coverImage', uploadedCoverUrl);
  } else if (editingId.value && originalCoverImageUrl.value && coverImageFileList.value.length === 0) {
    payload.append('removeCoverImage', 'true');
  } else if (cover?.url) {
    payload.append('coverImage', cover.url);
  }

  for (const file of slidesFileList.value) {
    if (file.originFileObj) {
      const uploadedSlideUrl = await uploadSceneSpotResourceFile(file.originFileObj as File, `scene-spot-slide-${sceneSpotFormModel.title.trim() || 'image'}`);
      finalSlideUrls.push(uploadedSlideUrl);
      continue;
    }
    const existingUrl = getFileUrl(file);
    if (existingUrl) {
      finalSlideUrls.push(existingUrl);
    }
  }
  payload.append('slides', JSON.stringify(finalSlideUrls));

  submitting.value = true;
  try {
    if (editingId.value) {
      await updateSceneSpotApi(editingId.value, payload);
      message.success(t('page.sceneSpots.index.message.updateSuccess'));
    } else {
      await createSceneSpotApi(payload);
      message.success(t('page.sceneSpots.index.message.createSuccess'));
    }
    modalOpen.value = false;
    sceneSpotGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

const locationRules = [
  {
    validator: async () => {
      const value = sceneSpotFormModel.locationText.trim();
      if (!value) {
        return;
      }

      if (!parseLocationText(value)) {
        throw new Error(t('page.sceneSpots.index.formFields.location.invalid'));
      }
    },
  },
];

function handleDelete(row: SceneSpotItem) {
  Modal.confirm({
    title: t('page.sceneSpots.index.confirm.delete.title', { name: row.title }),
    content: t('page.sceneSpots.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotApi(row.id);
      message.success(t('page.sceneSpots.index.message.deleteSuccess'));
      await sceneSpotGridApi.query();
    },
  });
}

async function toggleHome(row: SceneSpotItem, checked: unknown) {
  const flag = Boolean(checked === true || checked === 'true' || checked === 1 || checked === '1');
  const prev = row.isHome;
  // prevent duplicate
  if (homeLoading[row.id]) return;
  homeLoading[row.id] = true;
  // optimistic update
  row.isHome = flag;
  try {
    const payload = new FormData();
    payload.append('isHome', String(flag));
    await updateSceneSpotApi(row.id, payload);
    message.success(t('page.sceneSpots.index.message.updateSuccess'));
    sceneSpotGridApi.reload();
  } catch (err) {
    row.isHome = prev;
    homeError[row.id] = true;
    // clear error highlight after short delay
    setTimeout(() => {
      homeError[row.id] = false;
    }, 1400);
    message.error(t('page.sceneSpots.index.message.updateFailed'));
  } finally {
    homeLoading[row.id] = false;
  }
}

const [SceneSpotGrid, sceneSpotGridApi] = useVbenVxeGrid<SceneSpotItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.sceneSpots.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.sceneSpots.index.form.keyword.placeholder'),
        },
      },
      {
        component: 'Select',
        fieldName: 'sceneId',
        label: t('page.sceneSpots.index.form.sceneId.label'),
        componentProps: {
          allowClear: true,
          filterOption: false,
          loading: sceneOptionsLoading,
          onPopupScroll: handleScenePopupScroll,
          onSearch: handleSceneSearch,
          options: sceneOptions,
          placeholder: t('page.sceneSpots.index.form.sceneId.placeholder'),
          showSearch: true,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'title', minWidth: 180, title: t('page.sceneSpots.index.table.titleCol') },
      { field: 'sceneId', minWidth: 220, title: t('page.sceneSpots.index.table.sceneId'), slots: { default: 'sceneName' } },
      { field: 'category', minWidth: 160, title: t('page.sceneSpots.index.table.category'), slots: { default: 'category' } },
      { field: 'isHome', minWidth: 120, title: t('page.sceneSpots.index.table.isHome'), slots: { default: 'isHome' } },
      { field: 'averageRating', minWidth: 120, title: t('page.sceneSpots.index.table.averageRating') },
      { field: 'ratingCount', minWidth: 120, title: t('page.sceneSpots.index.table.ratingCount') },
      { field: 'favoriteCount', minWidth: 120, title: t('page.sceneSpots.index.table.favoriteCount') },
      { field: 'order', minWidth: 100, title: t('page.sceneSpots.index.table.order') },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.sceneSpots.index.table.updatedAt') },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 160,
        slots: { default: 'actions' },
        title: t('page.sceneSpots.index.table.actions'),
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: Record<string, any>,
        ) => {
          return await listSceneSpotsApi({
            keyword: formValues.keyword || undefined,
            sceneId: formValues.sceneId || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'order', order: 'asc' },
      remote: false,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
});

onMounted(async () => {
  try {
    await loadSceneOptions(true);
    await loadCategoryOptions();
  } catch {
    message.error(t('page.sceneSpots.index.message.loadScenesFailed'));
  }
});
</script>

<template>
  <div class="p-5">
    <SceneSpotGrid>
      <template #toolbar-actions>
        <Button v-access:code="'sceneSpot:write'" type="primary" @click="openCreateModal">
          {{ t('page.sceneSpots.index.toolbar.create') }}
        </Button>
      </template>

      <template #sceneName="{ row }">
        {{ sceneNameMap[row.sceneId] || row.sceneId }}
      </template>

      <template #title="{ row }">
        <span class="spot-title">{{ row.title }}</span>
        <span v-if="row.isFeatured" class="inline-badge featured-badge" title="精选"><StarOutlined /></span>
        <span v-if="row.isHot" class="inline-badge hot-badge" title="热门"><FireOutlined /></span>
      </template>

      <template #category="{ row }">
        {{ row.category?.name || '-' }}
      </template>

      <template #isHome="{ row }">
        <div :class="['home-cell', { 'home-error': homeError[row.id] }]">
          <Switch :checked="row.isHome" :loading="homeLoading[row.id]" @change="(checked: unknown) => toggleHome(row, checked)" />
        </div>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.sceneSpots.index.actions.detail')">
            <Button size="small" type="text" @click="openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>

          <Tooltip :title="t('page.sceneSpots.index.actions.comments')">
            <Button v-access:code="'comment:read'" size="small" type="text" @click="openComments(row)">
              <CommentOutlined />
            </Button>
          </Tooltip>

          <Tooltip :title="t('page.sceneSpots.index.actions.edit')">
            <Button v-access:code="'sceneSpot:write'" size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip :title="t('page.sceneSpots.index.actions.wechatQrLink')">
            <Button :loading="wechatQRCodeLoadingRowId === row.id" size="small" type="text" @click="openWechatQRCode(row)">
              <QrcodeOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.sceneSpots.index.actions.delete')">
            <Button v-access:code="'sceneSpot:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </SceneSpotGrid>

    <Modal
      :open="modalOpen"
      :width="900"
      :confirm-loading="submitting"
      :title="modalTitle"
      :ok-text="t('page.sceneSpots.index.modal.ok')"
      :cancel-text="t('page.sceneSpots.index.modal.cancel')"
      destroy-on-close
      @cancel="() => { modalOpen = false; resetForm(); }"
      @ok="submitSceneSpot"
    >
      <Form ref="sceneSpotFormRef" :label-col="{ span: 6 }" :model="sceneSpotFormModel" :wrapper-col="{ span: 17 }">
        <Tabs :default-active-key="'basic'">
          <Tabs.TabPane key="basic" :tab="t('page.sceneSpots.index.tabs.basic')">
            <Form.Item :label="t('page.sceneSpots.index.formFields.sceneId.label')" name="sceneId" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.sceneId.required') }]">
              <Select
                v-model:value="sceneSpotFormModel.sceneId"
                :filter-option="false"
                :loading="sceneOptionsLoading"
                :options="sceneOptions"
                @popupScroll="handleScenePopupScroll"
                @search="handleSceneSearch"
                show-search
                :placeholder="t('page.sceneSpots.index.formFields.sceneId.placeholder')"
              />
            </Form.Item>

            <Form.Item :label="t('page.sceneSpots.index.formFields.title.label')" name="title" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.title.required') }]">
              <Input v-model:value="sceneSpotFormModel.title" allow-clear />
            </Form.Item>

            <Form.Item :label="t('page.sceneSpots.index.formFields.category.label')" name="categoryId" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.category.required') }]">
              <TreeSelect
                v-model:value="sceneSpotFormModel.categoryId"
                :tree-data="categoryTreeData"
                :loading="categoryOptionsLoading"
                allow-clear
                show-search
                tree-node-filter-prop="title"
                :field-names="{ label: 'title', value: 'value', children: 'children' }"
                :placeholder="t('page.sceneSpots.index.formFields.category.placeholder')"
              />
            </Form.Item>

            <Form.Item :label="t('page.sceneSpots.index.formFields.coverImage.label')" name="coverImage" :rules="coverImageRules">
              <Upload
                v-bind="uploadProps"
                :file-list="coverImageFileList"
                list-type="picture-card"
                @change="handleCoverImageChange"
                @preview="handlePreview"
              >
                <div v-if="coverImageFileList.length < 1">+ {{ t('page.sceneSpots.index.formFields.coverImage.upload') }}</div>
              </Upload>
              <div class="upload-note">{{ t('page.sceneSpots.index.help.coverImageSize', { width: COVER_IMAGE_WIDTH, height: COVER_IMAGE_HEIGHT }) }}</div>
            </Form.Item>

            <Form.Item :label="t('page.sceneSpots.index.formFields.slides.label')" name="slides" :rules="slidesRules">
              <Upload
                v-bind="uploadProps"
                :file-list="slidesFileList"
                multiple
                list-type="picture-card"
                @change="handleSlidesChange"
                @preview="handlePreview"
              >
                <div v-if="slidesFileList.length < MAX_SLIDES_COUNT">+ {{ t('page.sceneSpots.index.formFields.coverImage.upload') }}</div>
              </Upload>
              <div class="upload-note">
                {{ t('page.sceneSpots.index.help.slideImageSize', { width: SLIDE_IMAGE_RECOMMENDED_WIDTH, height: SLIDE_IMAGE_RECOMMENDED_HEIGHT, max: MAX_SLIDES_COUNT, ratio: '16:9' }) }}
              </div>
            </Form.Item>

            <Form.Item :label="t('page.sceneSpots.index.formFields.isHome.label')" name="isHome">
              <Switch v-model:checked="sceneSpotFormModel.isHome" />
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.description.label')" name="description" :rules="[{ required: true, message: t('page.sceneSpots.index.formFields.description.required') }]">
              <TextArea v-model:value="sceneSpotFormModel.description" :rows="3" />
            </Form.Item>
          </Tabs.TabPane>

          <Tabs.TabPane key="other" :tab="t('page.sceneSpots.index.tabs.other')">
            <Form.Item :label="t('page.sceneSpots.index.formFields.address.label')" name="address">
              <Input v-model:value="sceneSpotFormModel.address" allow-clear />
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.location.label')" name="locationText" :rules="locationRules">
              <div class="location-field">
                <Input
                  v-model:value="sceneSpotFormModel.locationText"
                  allow-clear
                  class="location-input"
                  :placeholder="t('page.sceneSpots.index.formFields.location.placeholder')"
                />
                <Button class="location-open-map" html-type="button" type="default" @click="openBaiduMapGetPoint">
                  <LinkOutlined />
                  <span>{{ t('page.sceneSpots.index.formFields.location.openMap') }}</span>
                </Button>
              </div>
              <div class="location-help">{{ t('page.sceneSpots.index.help.location') }}</div>
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.order.label')" name="order">
              <InputNumber v-model:value="sceneSpotFormModel.order" :min="0" style="width: 100%" />
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.averageRating.label')" name="averageRating">
              <InputNumber v-model:value="sceneSpotFormModel.averageRating" :min="0" :max="5" :step="0.1" style="width: 100%" />
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.ratingCount.label')" name="ratingCount">
              <InputNumber v-model:value="sceneSpotFormModel.ratingCount" :min="0" :precision="0" style="width: 100%" />
            </Form.Item>
            <Form.Item :label="t('page.sceneSpots.index.formFields.favoriteCount.label')" name="favoriteCount">
              <InputNumber v-model:value="sceneSpotFormModel.favoriteCount" :min="0" :precision="0" style="width: 100%" />
            </Form.Item>
          </Tabs.TabPane>
        </Tabs>
      </Form>
    </Modal>

    <Modal :open="previewVisible" :title="previewTitle" :footer="null" @cancel="previewVisible = false">
      <img alt="preview" style="width: 100%" :src="previewImage" />
    </Modal>

    <Modal
      :open="wechatQRCodeModalOpen"
      :title="wechatQRCodeModalTitle"
      :ok-text="t('page.sceneSpots.index.wechatQr.modal.copy')"
      :cancel-text="t('page.sceneSpots.index.wechatQr.modal.close')"
      destroy-on-close
      @cancel="closeWechatQRCodeModal"
      @ok="copyWechatQRCodeLink"
    >
      <div class="wechat-qr-modal-body">
        <Tabs v-model:activeKey="wechatQRCodeActiveTab">
          <Tabs.TabPane key="wechat-rule-link" :tab="t('page.sceneSpots.index.wechatQr.modal.tabs.ruleLink')">
            <div class="wechat-qr-modal-hint">
              {{ t('page.sceneSpots.index.wechatQr.modal.hint') }}
            </div>
            <TextArea
              v-model:value="wechatQRCodeValue"
              :auto-size="{ minRows: 5, maxRows: 10 }"
              allow-clear
              :placeholder="t('page.sceneSpots.index.wechatQr.modal.placeholder')"
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="plain-url-scheme" :tab="t('page.sceneSpots.index.wechatQr.modal.tabs.plainUrlScheme')">
            <div class="wechat-qr-modal-hint">
              {{ t('page.sceneSpots.index.wechatQr.modal.urlSchemeHint') }}
            </div>
            <TextArea
              v-model:value="wechatUrlSchemeValue"
              :auto-size="{ minRows: 5, maxRows: 10 }"
              allow-clear
              :placeholder="t('page.sceneSpots.index.wechatQr.modal.urlSchemePlaceholder')"
            />
            <div class="wechat-qr-modal-query-title">
              {{ t('page.sceneSpots.index.wechatQr.modal.decodedQueryTitle') }}
            </div>
            <div class="wechat-qr-modal-hint">
              {{ t('page.sceneSpots.index.wechatQr.modal.decodedQueryHint') }}
            </div>
            <TextArea
              :value="wechatDecodedQueryValue"
              :auto-size="{ minRows: 4, maxRows: 8 }"
              readonly
              :placeholder="t('page.sceneSpots.index.wechatQr.modal.decodedQueryPlaceholder')"
            />
          </Tabs.TabPane>
          <Tabs.TabPane key="mini-program-path" :tab="t('page.sceneSpots.index.wechatQr.modal.tabs.miniProgramPath')">
            <div class="wechat-qr-modal-hint">
              {{ t('page.sceneSpots.index.wechatQr.modal.miniProgramPathHint') }}
            </div>
            <TextArea
              v-model:value="wechatMiniProgramPathValue"
              :auto-size="{ minRows: 5, maxRows: 10 }"
              allow-clear
              :placeholder="t('page.sceneSpots.index.wechatQr.modal.miniProgramPathPlaceholder')"
            />
          </Tabs.TabPane>
        </Tabs>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.featured-cell {
  display: inline-block;
}
.featured-error {
  background-color: rgba(255, 77, 79, 0.06);
  border-left: 3px solid #ff4d4f;
  padding-left: 6px;
  border-radius: 4px;
  animation: featuredHighlight 1.2s ease;
}

.wechat-qr-modal-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wechat-qr-modal-hint {
  color: rgba(0, 0, 0, 0.65);
  font-size: 12px;
  line-height: 1.6;
}

.wechat-qr-modal-query-title {
  color: rgba(0, 0, 0, 0.88);
  font-size: 13px;
  font-weight: 600;
  margin-top: 12px;
}

.location-field {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.location-input {
  flex: 1;
  min-width: 0;
}

.location-open-map {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.location-help {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 6px;
}
@keyframes featuredHighlight {
  0% { box-shadow: 0 0 0 rgba(255,77,79,0.0); }
  40% { box-shadow: 0 0 10px rgba(255,77,79,0.28); }
  100% { box-shadow: none; }
}

.upload-note {
  color: #6b7280;
  font-size: 12px;
  margin-top: 6px;
}

.spot-title {
  margin-right: 8px;
  display: inline-block;
  vertical-align: middle;
}

.inline-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  margin-left: 6px;
  font-size: 12px;
}

.featured-badge {
  background: linear-gradient(90deg, #ffd54f, #ffb340);
  color: #1a1f2e;
}

.hot-badge {
  background: linear-gradient(90deg, #ff6b6b, #ff3b3b);
  color: #ffffff;
}
</style>

