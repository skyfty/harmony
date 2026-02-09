import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defineStore } from 'pinia';
import type { SceneJsonExportDocument } from '@/types/scene';

export interface StoredSceneEntry {
    id: string;
    savedAt: string;
    origin?: string;
    scene: SceneJsonExportDocument;
}

const STORAGE_KEY = 'SCENE_LIBRARY_V1';

 function generateId(prefix = 'scene'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}

function isValidSceneDocument(document: unknown): document is SceneJsonExportDocument {
    if (!document || typeof document !== 'object') {
        return false;
    }
    const candidate = document as SceneJsonExportDocument;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
        return false;
    }
    if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.materials)) {
        return false;
    }
    return true;
}

export function parseSceneDocument(payload: unknown): SceneJsonExportDocument {
    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            if (isValidSceneDocument(parsed)) {
                return parsed;
            }
        } catch (_error) {
            throw new Error('JSON 解析失败');
        }
        throw new Error('场景数据格式不正确');
    }

    if (isValidSceneDocument(payload)) {
        return payload;
    }

    throw new Error('场景数据格式不正确');
}

export function createSceneEntry(scene: SceneJsonExportDocument, origin?: string): StoredSceneEntry {
    const entry: StoredSceneEntry = {
        id: generateId('scene'),
        savedAt: new Date().toISOString(),
        scene,
    };
    if (typeof origin === 'string' && origin.trim().length) {
        (entry as any).origin = origin;
    }
    return entry;
}



type SceneStoreSetup = {
    scenes: Ref<StoredSceneEntry[]>;
    initialized: Ref<boolean>;
    orderedScenes: ComputedRef<StoredSceneEntry[]>;
    bootstrap: () => void;
    setScenes: (entries: StoredSceneEntry[]) => void;
    upsertScene: (entry: StoredSceneEntry) => StoredSceneEntry;
    importScene: (scene: SceneJsonExportDocument, origin?: string) => StoredSceneEntry;
    removeScene: (sceneId: string) => void;
    getScene: (sceneId: string) => StoredSceneEntry | undefined;
};

export const useSceneStore = defineStore('sceneStore', (): SceneStoreSetup => {
    const scenes = ref<StoredSceneEntry[]>([]);
    const initialized = ref(false);

    const orderedScenes = computed(() => [...scenes.value].sort((a, b) => (a.savedAt > b.savedAt ? -1 : 1)));

    function bootstrap() {
        if (initialized.value) {
            return;
        }
        scenes.value = loadScenesFromStorage();
        initialized.value = true;
    }

    function loadScenesFromStorage(): StoredSceneEntry[] {
        try {
            const raw = uni.getStorageSync(STORAGE_KEY);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            const sanitized: StoredSceneEntry[] = [];
            parsed.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const { id, savedAt, origin, scene } = entry as StoredSceneEntry;
                if (typeof id !== 'string' || typeof savedAt !== 'string') {
                    return;
                }
                try {
                    const parsedScene = parseSceneDocument(scene);
                    const sanitizedEntry: StoredSceneEntry = { id, savedAt, scene: parsedScene };
                    if (typeof origin === 'string' && origin.trim().length) {
                        (sanitizedEntry as any).origin = origin;
                    }
                    sanitized.push(sanitizedEntry);
                } catch (_error) {
                    // ignore invalid entries
                }
            });
            return sanitized;
        } catch (_error) {
            return [];
        }
    }

    function persistScenes(entries: StoredSceneEntry[]): void {
        try {
            uni.setStorageSync(STORAGE_KEY, JSON.stringify(entries));
        } catch (_error) {
            // ignore storage errors
        }
    }
    function setScenes(entries: StoredSceneEntry[]) {
        scenes.value = entries;
        persistScenes(scenes.value);
    }

    function upsertScene(entry: StoredSceneEntry) {
        const index = scenes.value.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
            const next = [...scenes.value];
            next.splice(index, 1, entry);
            scenes.value = next;
            persistScenes(scenes.value);
            return entry;
        }
        scenes.value = [entry, ...scenes.value];

        persistScenes(scenes.value);
        return entry;
    }

    function importScene(scene: SceneJsonExportDocument, origin?: string) {
        const entry = createSceneEntry(scene, origin);
        return upsertScene(entry);
    }

    function removeScene(sceneId: string) {
        scenes.value = scenes.value.filter((item) => item.id !== sceneId);
        persistScenes(scenes.value);
    }

    function getScene(sceneId: string) {
        return scenes.value.find((item) => item.id === sceneId);
    }

    return {
        scenes,
        initialized,
        orderedScenes,
        bootstrap,
        setScenes,
        upsertScene,
        importScene,
        removeScene,
        getScene,
    };
});
