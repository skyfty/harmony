import { parseSceneBundle } from '../../utils/scene-loader';
const pageState = {
    registry: new Map(),
    order: [],
};
const builtinSources = [
 
];
function composeSceneSummary(scene) {
    var _a, _b;
    const nodeCount = (_b = (_a = scene.nodes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    const updated = scene.updatedAt ? scene.updatedAt.slice(0, 10) : '未知';
    return `节点 ${nodeCount} · 更新 ${updated}`;
}
function registerBundle(bundle, sourceKey, source) {
    var _a;
    if (!((_a = bundle === null || bundle === void 0 ? void 0 : bundle.scenes) === null || _a === void 0 ? void 0 : _a.length)) {
        return null;
    }
    let firstKey = null;
    bundle.scenes.forEach((scene, index) => {
        const sceneId = scene.id || `scene-${index}`;
        const key = `${sourceKey}:${sceneId}`;
        const entry = {
            key,
            sceneId,
            bundle,
            name: scene.name || `未命名场景 ${index + 1}`,
            summary: composeSceneSummary(scene),
            source,
        };
        if (!pageState.registry.has(key)) {
            pageState.order.push(key);
        }
        pageState.registry.set(key, entry);
        if (!firstKey) {
            firstKey = key;
        }
    });
    return firstKey;
}
function buildOptionList() {
    return pageState.order
        .map((key) => pageState.registry.get(key))
        .filter((entry) => Boolean(entry))
        .map((entry) => ({ key: entry.key, name: entry.name, summary: entry.summary, source: entry.source }));
}
function findEntryByKey(key) {
    var _a;
    return (_a = pageState.registry.get(key)) !== null && _a !== void 0 ? _a : null;
}
Page({
    data: {
        sceneOptions: [],
        selectedSceneKey: '',
        selectedSceneId: '',
        currentBundle: null,
        sceneUrl: '',
        statusMessage: '',
    },
    onLoad() {
        var _a, _b, _c;
        pageState.registry.clear();
        pageState.order.length = 0;
        builtinSources.forEach(({ sourceKey, bundle }) => {
            registerBundle(bundle, sourceKey, 'builtin');
        });
        const options = buildOptionList();
        const firstEntry = options.length ? findEntryByKey(options[0].key) : null;
        this.setData({
            sceneOptions: options,
            selectedSceneKey: (_a = firstEntry === null || firstEntry === void 0 ? void 0 : firstEntry.key) !== null && _a !== void 0 ? _a : '',
            selectedSceneId: (_b = firstEntry === null || firstEntry === void 0 ? void 0 : firstEntry.sceneId) !== null && _b !== void 0 ? _b : '',
            currentBundle: (_c = firstEntry === null || firstEntry === void 0 ? void 0 : firstEntry.bundle) !== null && _c !== void 0 ? _c : null,
            statusMessage: firstEntry ? `加载内置场景「${firstEntry.name}」` : '请导入场景 JSON',
        });
    },
    handleSelectScene(event) {
        var _a, _b;
        const key = (_b = (_a = event.currentTarget) === null || _a === void 0 ? void 0 : _a.dataset) === null || _b === void 0 ? void 0 : _b.id;
        if (!key) {
            return;
        }
        const entry = findEntryByKey(key);
        if (!entry) {
            this.setData({ statusMessage: '未找到选中的场景条目' });
            return;
        }
        this.setData({
            selectedSceneKey: entry.key,
            selectedSceneId: entry.sceneId,
            currentBundle: entry.bundle,
            statusMessage: `场景「${entry.name}」加载中...`,
        });
    },
    handleChooseLocal() {
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            extension: ['json'],
            success: (result) => {
                var _a;
                const file = (_a = result.tempFiles) === null || _a === void 0 ? void 0 : _a[0];
                if (!file) {
                    this.setData({ statusMessage: '未选择文件' });
                    return;
                }
                wx.getFileSystemManager().readFile({
                    filePath: file.path,
                    encoding: 'utf-8',
                    success: (readRes) => {
                        const content = readRes.data;
                        this.loadBundleFromString(content, file.name || 'local');
                    },
                    fail: (error) => {
                        this.setData({ statusMessage: `读取文件失败: ${error.errMsg}` });
                    },
                });
            },
            fail: (error) => {
                var _a, _b;
                if (error && ((_a = error.errMsg) === null || _a === void 0 ? void 0 : _a.includes('cancel'))) {
                    this.setData({ statusMessage: '已取消选择文件' });
                }
                else {
                    this.setData({ statusMessage: `选择文件失败: ${(_b = error === null || error === void 0 ? void 0 : error.errMsg) !== null && _b !== void 0 ? _b : '未知错误'}` });
                }
            },
        });
    },
    handleUrlInput(event) {
        this.setData({ sceneUrl: event.detail.value });
    },
    handleLoadFromUrl() {
        const url = (this.data.sceneUrl || '').trim();
        if (!url) {
            this.setData({ statusMessage: '请输入有效的场景 JSON URL' });
            return;
        }
        this.setData({ statusMessage: '正在下载场景...' });
        wx.request({
            url,
            method: 'GET',
            responseType: 'text',
            success: (res) => {
                if (res.statusCode === 200 && typeof res.data === 'string') {
                    this.loadBundleFromString(res.data, url);
                }
                else {
                    this.setData({ statusMessage: `下载失败 (${res.statusCode})` });
                }
            },
            fail: (error) => {
                var _a;
                this.setData({ statusMessage: `请求失败: ${(_a = error.errMsg) !== null && _a !== void 0 ? _a : error}` });
            },
        });
    },
    loadBundleFromString(content, origin) {
        var _a, _b, _c;
        let parsed;
        try {
            parsed = parseSceneBundle(content);
        }
        catch (error) {
            this.setData({ statusMessage: `解析场景失败: ${error.message}` });
            return;
        }
        const importedKey = `imported:${origin}:${Date.now()}`;
        const firstKey = registerBundle(parsed, importedKey, 'imported');
        const options = buildOptionList();
        const entry = firstKey ? findEntryByKey(firstKey) : null;
        this.setData({
            sceneOptions: options,
            selectedSceneKey: (_a = entry === null || entry === void 0 ? void 0 : entry.key) !== null && _a !== void 0 ? _a : this.data.selectedSceneKey,
            selectedSceneId: (_b = entry === null || entry === void 0 ? void 0 : entry.sceneId) !== null && _b !== void 0 ? _b : this.data.selectedSceneId,
            currentBundle: (_c = entry === null || entry === void 0 ? void 0 : entry.bundle) !== null && _c !== void 0 ? _c : this.data.currentBundle,
            statusMessage: entry ? `已导入场景「${entry.name}」` : '场景导入成功',
        });
    },
    handleViewerState(event) {
        var _a, _b, _c;
        const detail = event.detail;
        if (!detail) {
            return;
        }
        switch (detail.state) {
            case 'loading':
                this.setData({ statusMessage: (_a = detail.message) !== null && _a !== void 0 ? _a : '场景加载中...' });
                break;
            case 'ready':
                this.setData({ statusMessage: (_b = detail.message) !== null && _b !== void 0 ? _b : '场景加载完成' });
                break;
            case 'error':
                this.setData({ statusMessage: (_c = detail.message) !== null && _c !== void 0 ? _c : '场景加载失败' });
                break;
            default:
                break;
        }
    },
});
