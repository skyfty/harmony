import { ref, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { removeScenePackageZip, type ScenePackagePointer } from '@harmony/utils';

export interface ProjectConfig {
  id: string;
  name: string;
  defaultSceneId: string | null;
  lastEditedSceneId: string | null;
  sceneOrder: string[];
}

export interface StoredProjectEntry {
  id: string;
  savedAt: string;
  origin?: string;
  scenePackage: ScenePackagePointer;
  project: {
    id: string;
    name: string;
    defaultSceneId: string | null;
    lastEditedSceneId: string | null;
    sceneOrder: string[];
  };
  sceneCount: number;
}

const STORAGE_KEY = 'PROJECT_LIBRARY_V3';

function generateId(prefix = 'project'): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}

function isProjectConfig(raw: unknown): raw is ProjectConfig {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<ProjectConfig>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && Array.isArray(candidate.sceneOrder);
}

export function createProjectEntryFromScenePackage(
  payload: {
    scenePackage: ScenePackagePointer;
    project: ProjectConfig;
    sceneCount: number;
  },
  origin?: string,
): StoredProjectEntry {
  const scenePackage = payload.scenePackage;
  if (!scenePackage || typeof scenePackage !== 'object') {
    throw new Error('场景包数据为空');
  }

  const projectConfig = payload.project;
  const projectId =
    typeof projectConfig.id === 'string' && projectConfig.id.trim().length
      ? projectConfig.id.trim()
      : generateId('project');
  const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
  const sceneOrder = Array.isArray(projectConfig.sceneOrder) ? projectConfig.sceneOrder.filter((s) => typeof s === 'string') : [];

  return {
    id: projectId,
    savedAt: new Date().toISOString(),
    ...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
    scenePackage,
    project: {
      id: projectId,
      name: String(projectConfig.name ?? ''),
      defaultSceneId: projectConfig.defaultSceneId ?? null,
      lastEditedSceneId: projectConfig.lastEditedSceneId ?? null,
      sceneOrder,
    },
    sceneCount: Number.isFinite(payload.sceneCount) ? Math.max(0, Math.floor(payload.sceneCount)) : sceneOrder.length,
  };
}

type ProjectStoreSetup = {
  currentProject: Ref<StoredProjectEntry | null>;
  initialized: Ref<boolean>;
  bootstrap: () => void;
  setProject: (
    payload: { scenePackage: ScenePackagePointer; project: ProjectConfig; sceneCount: number },
    origin?: string,
  ) => StoredProjectEntry;
  clearProject: () => void;
  getProject: () => StoredProjectEntry | undefined;
};

export const useProjectStore = defineStore('projectStore', (): ProjectStoreSetup => {
  const currentProject = ref<StoredProjectEntry | null>(null);
  const initialized = ref(false);

  function bootstrap() {
    if (initialized.value) {
      return;
    }
    currentProject.value = loadProjectFromStorage();
    initialized.value = true;
  }

  function loadProjectFromStorage(): StoredProjectEntry | null {
    try {
      const raw = uni.getStorageSync(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const entry = JSON.parse(raw);
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const { id, savedAt, origin, scenePackage, project, sceneCount } = entry as StoredProjectEntry;
      if (typeof id !== 'string' || typeof savedAt !== 'string') {
        return null;
      }
      if (!scenePackage || typeof scenePackage !== 'object') {
        return null;
      }
      if (!('kind' in (scenePackage as any)) || !('ref' in (scenePackage as any))) {
        return null;
      }
      const kind = (scenePackage as any).kind;
      const ref = (scenePackage as any).ref;
      if ((kind !== 'wxfs' && kind !== 'idb') || typeof ref !== 'string' || !ref.trim()) {
        return null;
      }
      const rawProject = project as unknown;
      if (!isProjectConfig(rawProject)) {
        return null;
      }
      const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
      return {
        id,
        savedAt,
        ...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
        scenePackage: { kind, ref } as ScenePackagePointer,
        project: {
          id: typeof (rawProject as any).id === 'string' ? (rawProject as any).id : id,
          name: typeof (rawProject as any).name === 'string' ? (rawProject as any).name : '',
          defaultSceneId: (rawProject as any).defaultSceneId ?? null,
          lastEditedSceneId: (rawProject as any).lastEditedSceneId ?? null,
          sceneOrder: Array.isArray((rawProject as any).sceneOrder) ? (rawProject as any).sceneOrder : [],
        },
        sceneCount: Number.isFinite(sceneCount) ? Math.max(0, Math.floor(sceneCount)) : 0,
      };
    } catch (_error) {
      return null;
    }
  }

  function persistProject(entry: StoredProjectEntry | null): void {
    if (entry) {
      const payload = JSON.stringify(entry);
      uni.setStorageSync(STORAGE_KEY, payload);
    } else {
      uni.removeStorageSync(STORAGE_KEY);
    }
  }

  function setProject(
    payload: { scenePackage: ScenePackagePointer; project: ProjectConfig; sceneCount: number },
    origin?: string,
  ): StoredProjectEntry {
    const entry = createProjectEntryFromScenePackage(payload, origin);
    currentProject.value = entry;
    persistProject(entry);
    return entry;
  }

  function clearProject(): void {
    const entry = currentProject.value;
    currentProject.value = null;
    persistProject(null);
    void removeScenePackageZip(entry?.scenePackage);
  }

  function getProject(): StoredProjectEntry | undefined {
    return currentProject.value || undefined;
  }

  return {
    currentProject,
    initialized,
    bootstrap,
    setProject,
    clearProject,
    getProject,
  };
});
