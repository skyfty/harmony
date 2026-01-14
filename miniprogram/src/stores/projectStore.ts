import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defineStore } from 'pinia';
import {
	PROJECT_EXPORT_BUNDLE_FORMAT,
	PROJECT_EXPORT_BUNDLE_FORMAT_VERSION,
	type ProjectExportBundle,
} from '@harmony/schema';

export interface StoredProjectEntry {
	id: string;
	savedAt: string;
	origin?: string;
	bundle: ProjectExportBundle;
}

const STORAGE_KEY = 'PROJECT_LIBRARY_V1';

function generateId(prefix = 'project'): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	const random = Math.random().toString(36).slice(2, 10);
	const time = Date.now().toString(36);
	return `${prefix}-${time}-${random}`;
}

function isProjectExportBundle(raw: unknown): raw is ProjectExportBundle {
	if (!raw || typeof raw !== 'object') {
		return false;
	}
	const candidate = raw as Partial<ProjectExportBundle>;
	if (candidate.format !== PROJECT_EXPORT_BUNDLE_FORMAT) {
		return false;
	}
	if (candidate.formatVersion !== PROJECT_EXPORT_BUNDLE_FORMAT_VERSION) {
		return false;
	}
	if (!candidate.project || typeof candidate.project !== 'object') {
		return false;
	}
	if (!Array.isArray(candidate.scenes)) {
		return false;
	}
	return true;
}

export function parseProjectBundle(payload: unknown): ProjectExportBundle {
	if (typeof payload === 'string') {
		try {
			const parsed = JSON.parse(payload) as unknown;
			if (isProjectExportBundle(parsed)) {
				return parsed;
			}
		} catch (_error) {
			throw new Error('JSON 解析失败');
		}
		throw new Error('工程导出文件格式不正确');
	}

	if (isProjectExportBundle(payload)) {
		return payload;
	}

	throw new Error('工程导出文件格式不正确');
}

export function createProjectEntry(bundle: ProjectExportBundle, origin?: string): StoredProjectEntry {
	const projectId = typeof bundle.project?.id === 'string' && bundle.project.id.trim().length
		? bundle.project.id.trim()
		: generateId('project');
	const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
	return {
		id: projectId,
		savedAt: new Date().toISOString(),
		...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
		bundle,
	};
}

type ProjectStoreSetup = {
	projects: Ref<StoredProjectEntry[]>;
	initialized: Ref<boolean>;
	orderedProjects: ComputedRef<StoredProjectEntry[]>;
	bootstrap: () => void;
	importProject: (bundle: ProjectExportBundle, origin?: string) => StoredProjectEntry;
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
				const { id, savedAt, origin, bundle } = entry as StoredProjectEntry;
				if (typeof id !== 'string' || typeof savedAt !== 'string') {
					return;
				}
				try {
					const parsedBundle = parseProjectBundle(bundle);
					const normalizedOrigin = typeof origin === 'string' && origin.trim().length ? origin.trim() : '';
					sanitized.push({
						id,
						savedAt,
						...(normalizedOrigin ? { origin: normalizedOrigin } : {}),
						bundle: parsedBundle,
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

	function importProject(bundle: ProjectExportBundle, origin?: string): StoredProjectEntry {
		const entry = createProjectEntry(bundle, origin);
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
		importProject,
		removeProject,
		getProject,
	};
});
