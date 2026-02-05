<template>
    <view class="page">
        <view class="content">
            <view v-if="currentProject" class="current-project">
                <view class="project-card" @tap="openProject()">
                    <view class="card-header">
                        <text class="project-name">{{ currentProject.project.name || '未命名项目' }}</text>
                    </view>
                    <view class="card-meta">
                        <text>导入于 {{ formatDate(currentProject.savedAt) }}</text>
                        <text>场景数 {{ currentProject.sceneCount }} 个</text>
                    </view>
                    <view class="card-footer">
                        <text class="card-origin" v-if="currentProject.origin">来源：{{ currentProject.origin }}</text>
                    </view>
                </view>
                <button class="remove-button" @tap="removeProject">
                    移除项目
                </button>
            </view>

            <view v-else class="empty">
                <text class="empty-title">暂无项目</text>
                <text class="empty-desc">通过本地文件导入场景包 ZIP</text>
            </view>
        </view>

        <view class="toolbar">
            <button class="action primary" @tap="handleLocalImport" :disabled="importing">
                本地导入项目
            </button>
        </view>
    </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useProjectStore } from '@/stores/projectStore';
import { unzipScenePackage, readTextFileFromScenePackage } from '@harmony/schema';
import { saveScenePackageZip } from '@/utils/scenePackageStorage';

const projectStore = useProjectStore();
const { currentProject } = storeToRefs(projectStore);
const importing = ref(false);

onMounted(() => {
    projectStore.bootstrap();
});

const formatDate = (value?: string) => {
    if (!value) {
        return '未知时间';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
};

function openProject() {
    if (!currentProject.value) return;
    uni.navigateTo({ url: `/pages/scene-viewer/index?projectId=${encodeURIComponent(currentProject.value.id)}` });
}

function removeProject() {
    uni.showModal({
        title: '确认移除',
        content: '确定要移除当前项目吗？',
        success: (res) => {
            if (res.confirm) {
                projectStore.clearProject();
            }
        },
    });
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (input instanceof Uint8Array) {
        const safe = new ArrayBuffer(input.byteLength);
        new Uint8Array(safe).set(input);
        return safe;
    }
    return input;
}

function generateId(prefix = 'project'): string {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
    }
    const random = Math.random().toString(36).slice(2, 10);
    const time = Date.now().toString(36);
    return `${prefix}-${time}-${random}`;
}

async function readFileAsArrayBuffer(file: UniApp.ChooseFileSuccessCallbackResultFile): Promise<ArrayBuffer> {
    const anyFile = file as any;
    const fs = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null;
    const filePath: string | undefined = anyFile.path || anyFile.tempFilePath || anyFile.url;

    // 1) 小程序端：使用文件系统管理器直接读取二进制
    if (fs && filePath) {
        try {
            const buffer = await new Promise<ArrayBuffer>((resolve, reject) =>
                fs.readFile({
                    filePath,
                    success: (res: any) => resolve(res.data as ArrayBuffer),
                    fail: reject,
                }),
            );
            if (buffer && typeof (buffer as any).byteLength === 'number') {
                return buffer;
            }
        } catch (err) {
            console.warn('uni.getFileSystemManager 读取二进制失败，尝试其他方式', err);
        }
    }

    // 2) 微信小程序兜底
    const wxFileManager = typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (wxFileManager && filePath) {
        try {
            const buffer = await new Promise<ArrayBuffer>((resolve, reject) =>
                wxFileManager.readFile({
                    filePath,
                    success: (res: any) => resolve(res.data as ArrayBuffer),
                    fail: reject,
                }),
            );
            if (buffer && typeof (buffer as any).byteLength === 'number') {
                return buffer;
            }
        } catch (err) {
            console.warn('wx.getFileSystemManager 读取二进制失败，尝试其他方式', err);
        }
    }

    // 3) H5：Blob/File -> arrayBuffer
    let blob: Blob | undefined = anyFile.file as Blob | undefined;
    if (!blob && typeof File !== 'undefined' && file instanceof File) {
        blob = file as unknown as Blob;
    }
    if (!blob && typeof Blob !== 'undefined' && file instanceof Blob) {
        blob = file as Blob;
    }
    if (blob) {
        if (typeof (blob as any).arrayBuffer === 'function') {
            return (await (blob as any).arrayBuffer()) as ArrayBuffer;
        }
        return await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as ArrayBuffer) || new ArrayBuffer(0));
            reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
            reader.readAsArrayBuffer(blob as Blob);
        });
    }

    // 4) H5 fetch URL
    if (filePath && (/^blob:/i.test(filePath) || /^data:/i.test(filePath) || /^https?:/i.test(filePath))) {
        const res = await fetch(filePath);
        return await res.arrayBuffer();
    }

    throw new Error('当前平台暂不支持以二进制读取所选文件');
}

async function importScenePackageZip(zip: ArrayBuffer | Uint8Array, origin?: string) {
    const pkg = unzipScenePackage(zip);
    const projectText = readTextFileFromScenePackage(pkg, pkg.manifest.project.path);
    const projectConfig = JSON.parse(projectText) as any;

    if (!projectConfig || typeof projectConfig !== 'object') {
        throw new Error('项目文件格式不正确');
    }

    const projectId =
        typeof projectConfig.id === 'string' && projectConfig.id.trim().length ? projectConfig.id.trim() : generateId('project');
    const ab = toArrayBuffer(zip as any);
    const scenePackage = await saveScenePackageZip(ab, projectId);
    const sceneCount = Array.isArray(pkg.manifest.scenes) ? pkg.manifest.scenes.length : 0;

    const newProject = projectStore.setProject(
        {
            scenePackage,
            project: {
                id: projectId,
                name: String(projectConfig.name ?? ''),
                sceneOrder: Array.isArray(projectConfig.sceneOrder)
                    ? projectConfig.sceneOrder
                    : (Array.isArray(pkg.manifest.scenes) ? pkg.manifest.scenes.map((s) => s.sceneId) : []),
            } as any,
            sceneCount,
        },
        origin,
    );

    // Navigate to the project immediately after import
    setTimeout(() => {
        uni.navigateTo({ url: `/pages/scene-viewer/index?projectId=${encodeURIComponent(newProject.id)}` });
    }, 500);

    uni.showToast({ title: '项目导入成功', icon: 'success' });
}

async function handleLocalImport() {
    if (importing.value) {
        return;
    }
    importing.value = true;
    try {
        await new Promise<void>((resolve, reject) => {
            const canUseUniChooseFile = typeof uni.chooseFile === 'function';

            // 1) 优先使用 uni.chooseFile（H5/App 等支持的端）
            if (canUseUniChooseFile) {
                console.log('使用 uni.chooseFile 选择文件');
                uni.chooseFile({
                    count: 1,
                    extension: ['.zip'],
                    success: async (result) => {
                        const files = Array.isArray(result.tempFiles) ? result.tempFiles : [result.tempFiles];
                        const file = files[0] as UniApp.ChooseFileSuccessCallbackResultFile | undefined;
                        if (!file) {
                            reject(new Error('未选择文件'));
                            return;
                        }
                        try {
                            const name = (file as any).name || (file as any).path || '';
                            const lower = (name || '').toLowerCase();
                            const originName = (file as any).name || '本地文件';
                            if (!lower.endsWith('.zip')) {
                                reject(new Error('仅支持 .zip 场景包导入'));
                                return;
                            }
                            const bytes = await readFileAsArrayBuffer(file as any);
                            await importScenePackageZip(bytes as any, originName);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    },
                    fail: (err) => reject(err),
                });
                return;
            }

            // 2) 微信小程序端：使用 wx.chooseMessageFile 作为兜底
            const canUseWxChooseMessageFile =
                typeof wx !== 'undefined' && typeof (wx as any).chooseMessageFile === 'function';
            if (canUseWxChooseMessageFile) {
                console.log('使用 wx.chooseMessageFile 选择文件');
                (wx as any).chooseMessageFile({
                    count: 1,
                    type: 'file',
                    // 只接受 zip
                    extension: ['.zip', 'zip'],
                    success: async (res: any) => {
                        try {
                            const files = Array.isArray(res.tempFiles) ? res.tempFiles : [res.tempFiles];
                            const file = files[0] as any;
                            if (!file) {
                                reject(new Error('未选择文件'));
                                return;
                            }
                            const name = (file && (file.name || file.path)) || '';
                            const lower = (name || '').toLowerCase();
                            const originName = (file && (file.name || file.path)) || '本地文件';
                            if (!lower.endsWith('.zip')) {
                                reject(new Error('仅支持 .zip 场景包导入'));
                                return;
                            }
                            const bytes = await readFileAsArrayBuffer(file as any);
                            await importScenePackageZip(bytes as any, originName);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    },
                    fail: (err: any) => reject(err),
                });
                return;
            }

            // 3) 其他不支持的端
            reject(new Error('当前环境不支持文件选择，请在 H5/App 或支持的端导入'));
        });
    } catch (error) {
        console.error(error);
        uni.showToast({ title: '项目导入失败', icon: 'none' });
    } finally {
        importing.value = false;
    }
}

</script>

<style lang="scss">
.page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 16px;
    padding-top: 84px;
    padding-bottom: 96px;
    box-sizing: border-box;
    background-color: #f5f7fb;
    gap: 12px;
}

.content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 20px 0;
}

.toolbar {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    gap: 12px;
    z-index: 10;
}

.action {
    flex: 1;
    padding: 10px 12px;
    font-size: 15px;
    border-radius: 24px;
    border: none;
    background-color: #ffffff;
    color: #1a1a1a;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.action.primary {
    background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
    color: #ffffff;
}

.action[disabled] {
    opacity: 0.5;
}

.current-project {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.project-card {
    padding: 16px;
    border-radius: 16px;
    background-color: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.project-name {
    font-size: 18px;
    font-weight: 600;
    color: #1f1f1f;
}

.card-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: #6f7580;
}

.card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.card-origin {
    font-size: 12px;
    color: #8a8f9c;
    flex: 1;
}

.remove-button {
    padding: 8px 16px;
    border-radius: 20px;
    border: none;
    font-size: 13px;
    color: #d93025;
    background-color: rgba(217, 48, 37, 0.1);
    align-self: center;
}

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #7a7f8a;
    text-align: center;
}

.empty-title {
    font-size: 18px;
    font-weight: 600;
    color: #4a4d55;
    margin-bottom: 4px;
}

.empty-desc {
    font-size: 14px;
    color: #7a7f8a;
    line-height: 1.4;
}
</style>
