import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defineStore } from 'pinia';

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
	zipBase64: string;
	project: {
		id: string;
		name: string;
		defaultSceneId: string | null;
		lastEditedSceneId: string | null;
		sceneOrder: string[];
	};
	sceneCount: number;
}

const STORAGE_KEY = 'PROJECT_LIBRARY_V2';

function generateId(prefix = 'project'): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
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

export function createProjectEntryFromScenePackage(payload: {
	zipBase64: string;
	project: ProjectConfig;
	sceneCount: number;
}, origin?: string): StoredProjectEntry {
	const zipBase64 = (payload.zipBase64 ?? '').trim();
	if (!zipBase64) {
		throw new Error('场景包数据为空');
	}
	const projectConfig = payload.project;
	const projectId =
		typeof projectConfig.id === 'string' && projectConfig.id.trim().length
			? projectConfig.id.trim()
			: generateId('project');
	const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
	const sceneOrder = Array.isArray(projectConfig.sceneOrder)
		? projectConfig.sceneOrder.filter((s) => typeof s === 'string')
		: [];
	return {
		id: projectId,
		savedAt: new Date().toISOString(),
		...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
		zipBase64,
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
	setProject: (payload: { zipBase64: string; project: ProjectConfig; sceneCount: number }, origin?: string) => StoredProjectEntry;
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
			const { id, savedAt, origin, zipBase64, project, sceneCount } = entry as StoredProjectEntry;
			if (typeof id !== 'string' || typeof savedAt !== 'string' || typeof zipBase64 !== 'string') {
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
				zipBase64,
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
		payload: { zipBase64: string; project: ProjectConfig; sceneCount: number },
		origin?: string,
	): StoredProjectEntry {
		const entry = createProjectEntryFromScenePackage(payload, origin);
		currentProject.value = entry;
		persistProject(entry);
		return entry;
	}

	function clearProject(): void {
		currentProject.value = null;
		persistProject(null);
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
