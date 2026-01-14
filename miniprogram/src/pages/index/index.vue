<template>
    <view class="page">
        <view class="toolbar">
            <button class="action primary" @tap="handleLocalImport" :disabled="importing">
                本地导入项目
            </button>
        </view>

        <view class="stats">
            <text class="title">我的项目</text>
            <text class="count">{{ orderedProjects.length }} 个</text>
        </view>

        <scroll-view scroll-y class="scene-list">
            <view v-if="!orderedProjects.length && !importing" class="empty">
                <text class="empty-title">暂无项目</text>
                <text class="empty-desc">通过本地文件导入工程（Project）导出文件</text>
            </view>

            <view
                v-for="project in orderedProjects"
                :key="project.id"
                class="scene-card"
                @tap="openProject(project.id)"
            >
                <view class="card-header">
                    <text class="scene-name">{{ project.bundle.project.name || '未命名项目' }}</text>
                </view>
                <view class="card-meta">
                    <text>导入于 {{ formatDate(project.savedAt) }}</text>
                    <text>场景数 {{ project.bundle.scenes.length }} 个</text>
                </view>
                <view class="card-footer">
                    <text class="card-origin" v-if="project.origin">来源：{{ project.origin }}</text>
                </view>
            </view>
        </scroll-view>
    </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { parseProjectBundle, useProjectStore } from '@/stores/projectStore';

const projectStore = useProjectStore();
const { orderedProjects } = storeToRefs(projectStore);
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

function openProject(projectId: string) {
    uni.navigateTo({ url: `/pages/scene-viewer/index?projectId=${encodeURIComponent(projectId)}` });
}

async function readFileContent(file: UniApp.ChooseFileSuccessCallbackResultFile): Promise<string> {
    const anyFile = file as any;
    const fs = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null;
    const filePath: string | undefined = anyFile.path || anyFile.tempFilePath || anyFile.url;

    // 1) 小程序端：优先使用本地文件系统管理器读取
    if (fs && filePath) {
        try {
            const text = await new Promise<string>((resolve, reject) =>
                fs.readFile({
                    filePath,
                    encoding: 'utf-8',
                    success: (res: any) => resolve(res.data as string),
                    fail: reject,
                }),
            );
            return text;
        } catch (err) {
            console.warn('uni.getFileSystemManager 读取失败，尝试其他方式', err);
        }
    }

    // 2) 微信小程序兜底（保持与现有逻辑一致）
    const wxFileManager = typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (wxFileManager && filePath) {
        try {
            const text = await new Promise<string>((resolve, reject) =>
                wxFileManager.readFile({
                    filePath,
                    encoding: 'utf-8',
                    success: (res: any) => resolve(res.data as string),
                    fail: reject,
                }),
            );
            return text;
        } catch (err) {
            console.warn('wx.getFileSystemManager 读取失败，尝试其他方式', err);
        }
    }

    // 3) H5：尝试直接从 File/Blob 对象读取
    let blob: Blob | undefined = anyFile.file as Blob | undefined;
    // 某些平台 file 对象本身就是 File/Blob
    if (!blob && typeof File !== 'undefined' && file instanceof File) {
        blob = file as unknown as Blob;
    }
    if (!blob && typeof Blob !== 'undefined' && file instanceof Blob) {
        blob = file as Blob;
    }
    if (blob) {
        if (typeof (blob as any).text === 'function') {
            return await (blob as any).text();
        }
        const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string) || '');
            reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
            reader.readAsText(blob as Blob, 'utf-8');
        });
        return text;
    }

    // 4) H5：如果拿到的是 blob:/data:/http(s) URL，则通过 fetch 拉取内容
    if (filePath && (/^blob:/i.test(filePath) || /^data:/i.test(filePath) || /^https?:/i.test(filePath))) {
        const res = await fetch(filePath);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') || ct.startsWith('text/')) {
            return await res.text();
        }
        const b = await res.blob();
        if (typeof (b as any).text === 'function') {
            return await (b as any).text();
        }
        return await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve((fr.result as string) || '');
            fr.onerror = () => reject(fr.error ?? new Error('读取文件失败'));
            fr.readAsText(b, 'utf-8');
        });
    }

    // 5) 仍无法读取，给出明确提示
    throw new Error('当前平台暂不支持直接读取所选文件，请在 H5/App 端或使用支持的端导入');
}

async function importProject(bundle: unknown, origin?: string) {
    const projectBundle = parseProjectBundle(bundle);
    projectStore.importProject(projectBundle, origin);
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
                uni.chooseFile({
                    count: 1,
                    extension: ['.json'],
                    success: async (result) => {
                        const files = Array.isArray(result.tempFiles) ? result.tempFiles : [result.tempFiles];
                        const file = files[0] as UniApp.ChooseFileSuccessCallbackResultFile | undefined;
                        if (!file) {
                            reject(new Error('未选择文件'));
                            return;
                        }
                        try {
                            const content = await readFileContent(file);
                            const originName = (file as any).name || '本地文件';
                            await importProject(content, originName);
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
                (wx as any).chooseMessageFile({
                    count: 1,
                    type: 'file',
                    // 同时传入含/不含点的后缀，兼容性更好
                    extension: ['.json', 'json'],
                    success: async (res: any) => {
                        try {
                            const files = Array.isArray(res.tempFiles) ? res.tempFiles : [res.tempFiles];
                            const file = files[0] as any;
                            if (!file) {
                                reject(new Error('未选择文件'));
                                return;
                            }
                            const content = await readFileContent(file as any);
                            const originName = (file && (file.name || file.path)) || '本地文件';
                            await importProject(content, originName);
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
    padding: 16px 16px 96px;
  padding-top: 84px;
    box-sizing: border-box;
    background-color: #f5f7fb;
    gap: 12px;
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

.stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
    color: #4b4f58;
}

.title {
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
}

.count {
    font-size: 13px;
}

.scene-list {
    flex: 1;
    background-color: transparent;
    padding-bottom: 80px;
    box-sizing: border-box;
}

.scene-card {
    margin-bottom: 12px;
    padding: 14px;
    border-radius: 16px;
    background-color: #ffffff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.scene-name {
    font-size: 16px;
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

.delete-button {
    width: 64px;
    padding: 6px 0;
    border-radius: 16px;
    border: none;
    font-size: 13px;
    color: #d93025;
    background-color: rgba(217, 48, 37, 0.1);
}

.empty {
    margin-top: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #7a7f8a;
}

.empty-title {
    font-size: 16px;
    font-weight: 600;
    color: #4a4d55;
}

.empty-desc {
    font-size: 13px;
    color: #7a7f8a;
}

.dialog-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 1000;
}

.dialog {
    width: 100%;
    max-width: 320px;
    background-color: #ffffff;
    border-radius: 16px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.dialog-title {
    font-size: 16px;
    font-weight: 600;
    color: #1f1f1f;
}

.dialog-input {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 14px;
    color: #1f1f1f;
}

.dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

.dialog-button {
    padding: 8px 14px;
    border-radius: 18px;
    border: none;
    font-size: 14px;
    background-color: rgba(0, 0, 0, 0.08);
    color: #1f1f1f;
}

.dialog-button.primary {
    background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
    color: #ffffff;
}

.dialog-button[disabled] {
    opacity: 0.5;
}

</style>
