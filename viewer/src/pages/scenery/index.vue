<template>
  <view class="page">
    <SceneryViewer
      v-if="pageReady && !loadError"
      :project-id="projectId"
      :package-url="packageUrl"
      :nominate-state-map="nominateStateMap"
      :default-steer-identifier="selectedVehicleIdentifier"
      :server-asset-base-url="serverAssetBaseUrl"
      :initial-punched-node-ids="initialPunchedNodeIds"
      :physics-backend-loaders="physicsBackendLoaders"
      :physics-engine="resolvedPhysicsEngine"
      @punch="handlePunch"
    />

    <view v-else class="loading-state">
      <view class="loading-state__card">
        <text class="loading-state__title">正在准备场景</text>
        <text class="loading-state__desc">
          {{ loadError || '正在预加载对应的物理子包...' }}
        </text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import type { PhysicsBackendPreference } from '@harmony/physics-core';
import { createPunchRecord, getDownloadCdnBaseUrl, getPunchProgress, loadScenePackageZip } from '@harmony/utils';
import { decodeScenePackageSceneDocument, resolveDocumentEnvironment } from '@schema';
import { readBinaryFileFromScenePackage, readTextFileFromScenePackage, unzipScenePackage } from '@schema/scenePackageZip';
import { useProjectStore } from '@/stores/projectStore';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import type { SceneryPhysicsBackendLoaders } from './uni_modules/scenery/common/physics/createSceneryPhysicsBridge';

const projectStore = useProjectStore();

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const selectedVehicleIdentifier = ref<string>('');
const initialPunchedNodeIds = ref<string[]>([]);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();
const resolvedPhysicsEngine = ref<PhysicsBackendPreference>('ammo');
const loadError = ref<string>('');
const pageReady = ref(false);

const physicsBackendLoaders: SceneryPhysicsBackendLoaders = {
  loadAmmoRuntime: async () => {
    return await import('@/runtime/physics-ammo');
  },
  loadCannonRuntime: async () => {
    return await import('@/runtime/physics-cannon');
  },
};

const nominateStateMap = computed(() => {
  const vehicleIdentifier = selectedVehicleIdentifier.value.trim();
  if (!vehicleIdentifier) {
    return undefined;
  }
  return {
    [vehicleIdentifier]: {
      visible: true,
    },
  };
});

type PunchEventPayload = {
  eventName: 'punch';
  sceneId: string;
  sceneName: string;
  clientPunchTime: string;
  behaviorPunchTime: string;
  location: {
    nodeId: string;
    nodeName: string;
  };
};

type ScenePackageProjectConfigLike = {
  defaultSceneId?: unknown;
  sceneOrder?: unknown;
};

type ScenePackageSceneLike = {
  sceneId: string;
};

function decodeQueryValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed.includes('%')) {
    return trimmed;
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeSceneId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function resolvePhysicsEnginePreference(value: unknown): PhysicsBackendPreference {
  return value === 'cannon' ? 'cannon' : 'ammo';
}

function resolveInitialSceneId(
  projectConfig: ScenePackageProjectConfigLike,
  requestedSceneId: string | null,
  manifestScenes: ScenePackageSceneLike[],
): string | null {
  const sceneIdSet = new Set(manifestScenes.map((entry) => entry.sceneId));
  const requested = normalizeSceneId(requestedSceneId);
  if (requested && sceneIdSet.has(requested)) {
    return requested;
  }

  const defaultSceneId = normalizeSceneId(projectConfig.defaultSceneId);
  if (defaultSceneId && sceneIdSet.has(defaultSceneId)) {
    return defaultSceneId;
  }

  if (Array.isArray(projectConfig.sceneOrder)) {
    for (const candidate of projectConfig.sceneOrder) {
      const sceneId = normalizeSceneId(candidate);
      if (sceneId && sceneIdSet.has(sceneId)) {
        return sceneId;
      }
    }
  }

  return manifestScenes[0]?.sceneId ?? null;
}

async function loadWechatSubpackage(name: 'physicsAmmo' | 'physicsCannon'): Promise<void> {
  const wxLike = globalThis as {
    wx?: {
      loadSubpackage?: (options: {
        name: string;
        success?: () => void;
        fail?: (error: unknown) => void;
      }) => void;
    };
  };

  const loadSubpackage = wxLike.wx?.loadSubpackage;
  if (typeof loadSubpackage !== 'function') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    loadSubpackage({
      name,
      success: () => resolve(),
      fail: (error) => reject(error),
    });
  });
}

async function preloadPhysicsSubpackages(engine: PhysicsBackendPreference): Promise<void> {
  // SceneryViewer 的编译产物目前会先碰到 physics-ammo vendor，
  // 所以 ammo 需要作为基础依赖先预热；如果当前引擎是 cannon，再额外预热 cannon。
  await loadWechatSubpackage('physicsAmmo');
  if (engine === 'cannon') {
    await loadWechatSubpackage('physicsCannon');
  }
}

void (async () => {
  try {
    const engine = await resolveScenePhysicsEngine();
    resolvedPhysicsEngine.value = engine;
    await preloadPhysicsSubpackages(engine);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '场景加载失败';
    console.error('[scenery] initialize viewer failed', error);
  }
})();

async function resolveScenePhysicsEngine(): Promise<PhysicsBackendPreference> {
  projectStore.bootstrap();
  const entry = projectStore.getProject();
  if (!entry || entry.id !== projectId.value.trim()) {
    return 'ammo';
  }

  try {
    const packageBytes = await loadScenePackageZip(entry.scenePackage);
    const packageZip = unzipScenePackage(packageBytes);
    const projectConfig = JSON.parse(readTextFileFromScenePackage(packageZip, packageZip.manifest.project.path)) as ScenePackageProjectConfigLike;
    const requestedSceneId = sceneId.value.trim() || null;
    const sceneIdToOpen = resolveInitialSceneId(projectConfig, requestedSceneId, packageZip.manifest.scenes);
    if (!sceneIdToOpen) {
      return 'ammo';
    }

    const sceneEntry = packageZip.manifest.scenes.find((candidate) => candidate.sceneId === sceneIdToOpen);
    if (!sceneEntry) {
      return 'ammo';
    }

    const sceneDocument = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(packageZip, sceneEntry.path));
    return resolvePhysicsEnginePreference(resolveDocumentEnvironment(sceneDocument).physicsEngine);
  } catch (error) {
    console.warn('[scenery] resolve scene physics engine failed', error);
    return 'ammo';
  }
}

function handlePunch(payload: PunchEventPayload): void {
  if (!sceneSpotId.value) {
    return;
  }

  void createPunchRecord({
    sceneId: payload.sceneId,
    scenicId: sceneSpotId.value,
    sceneName: payload.sceneName,
    vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
    clientPunchTime: payload.clientPunchTime,
    behaviorPunchTime: payload.behaviorPunchTime,
    location: {
      nodeId: payload.location.nodeId,
      nodeName: payload.location.nodeName,
    },
    source: 'viewer-miniapp',
    path: '/pages/scenery/index',
  });
}

async function loadPunchProgress(): Promise<void> {
  if (!sceneId.value || !sceneSpotId.value) {
    initialPunchedNodeIds.value = [];
    return;
  }

  try {
    const progress = await getPunchProgress({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
    });
    initialPunchedNodeIds.value = Array.isArray(progress.punchedNodeIds)
      ? (progress.punchedNodeIds as string[]).filter((nodeId: string) => nodeId.trim().length > 0)
      : [];
  } catch {
    initialPunchedNodeIds.value = [];
  }
}

onLoad((query: Record<string, unknown> | undefined) => {
  pageReady.value = false;
  loadError.value = '';
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = decodeQueryValue(record.packageUrl);
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleIdentifier.value = typeof record.vehicleIdentifier === 'string' ? record.vehicleIdentifier : 'car1';

  void loadPunchProgress();
  pageReady.value = true;
});

onUnload(() => {
  pageReady.value = false;
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}

.loading-state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fa 100%);
}

.loading-state__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  padding: 20px 24px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 30px rgba(31, 47, 77, 0.12);
}

.loading-state__title {
  font-size: 16px;
  font-weight: 600;
  color: #202531;
}

.loading-state__desc {
  font-size: 13px;
  color: #667085;
}
</style>
