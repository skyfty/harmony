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
	projects: Ref<StoredProjectEntry[]>;
	initialized: Ref<boolean>;
	orderedProjects: ComputedRef<StoredProjectEntry[]>;
	bootstrap: () => void;
	importScenePackage: (payload: { zipBase64: string; project: ProjectConfig; sceneCount: number }, origin?: string) => StoredProjectEntry;
	removeProject: (projectId: string) => void;
	getProject: (projectId: string) => StoredProjectEntry | undefined;
};

export const useProjectStore = defineStore('projectStore', (): ProjectStoreSetup => {
	const projects = ref<StoredProjectEntry[]>([]);
	const initialized = ref(false);

	const orderedProjects = computed(() => [...projects.value].sort((a, b) => (a.savedAt > b.savedAt ? -1 : 1)));

	function bootstrap() {
		if (initialized.value) {
			return;
		}
		projects.value = loadProjectsFromStorage();
		initialized.value = true;
	}

	function loadProjectsFromStorage(): StoredProjectEntry[] {
		try {
			const raw = uni.getStorageSync(STORAGE_KEY);
			if (!raw) {
				return [];
			}
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				return [];
			}
			const sanitized: StoredProjectEntry[] = [];
			parsed.forEach((entry) => {
				if (!entry || typeof entry !== 'object') {
					return;
				}
				const { id, savedAt, origin, zipBase64, project, sceneCount } = entry as StoredProjectEntry;
				if (typeof id !== 'string' || typeof savedAt !== 'string' || typeof zipBase64 !== 'string') {
					return;
				}
				try {
					const rawProject = project as unknown;
					if (!isProjectConfig(rawProject)) {
						return;
					}
					const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
					sanitized.push({
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
					});
				} catch (_error) {
					// ignore invalid entries
				}
			});
			return sanitized;
		} catch (_error) {
			return [];
		}
	}

	function persistProjects(entries: StoredProjectEntry[]): void {
		const payload = JSON.stringify(entries);
		uni.setStorageSync(STORAGE_KEY, payload);
	}

	function upsertProject(entry: StoredProjectEntry): StoredProjectEntry {
		const index = projects.value.findIndex((item) => item.id === entry.id);
		if (index >= 0) {
			const next = [...projects.value];
			next.splice(index, 1, entry);
			projects.value = next;
			persistProjects(projects.value);
			return entry;
		}
		projects.value = [entry, ...projects.value];
		persistProjects(projects.value);
		return entry;
	}

	function importScenePackage(
		payload: { zipBase64: string; project: ProjectConfig; sceneCount: number },
		origin?: string,
	): StoredProjectEntry {
		const entry = createProjectEntryFromScenePackage(payload, origin);
		return upsertProject(entry);
	}

	function removeProject(projectId: string): void {
		projects.value = projects.value.filter((item) => item.id !== projectId);
		persistProjects(projects.value);
	}

	function getProject(projectId: string): StoredProjectEntry | undefined {
		return projects.value.find((item) => item.id === projectId);
	}

	return {
		projects,
		initialized,
		orderedProjects,
		bootstrap,
		importScenePackage,
		removeProject,
		getProject,
	};
});
