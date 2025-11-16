import { AssetLoader, type AssetCacheEntry, type AssetSource } from './assetCache';
import type { SceneGraphBuildOptions } from './sceneGraph';
import type { MaterialAssetSource, MaterialAssetProvider } from './material';
import type { SceneJsonExportDocument } from '@harmony/schema';

function extractPresetRelativePath(candidate: string): string | null {
  if (!candidate) {
    return null;
  }
  const withoutQuery = candidate.replace(/\?.*$/, '');
  const parts = withoutQuery.split(/[\\/]+/).filter(Boolean);
  const presetIndex = parts.lastIndexOf('preset');
  if (presetIndex === -1) {
    return null;
  }
  const relativeSegments = parts.slice(presetIndex + 1);
  if (!relativeSegments.length) {
    return null;
  }
  return relativeSegments.join('/');
}

const NodeBuffer: { from: (data: string, encoding: string) => any } | undefined =
  typeof globalThis !== 'undefined' && (globalThis as any).Buffer
    ? (globalThis as any).Buffer
    : undefined;

type AssetDownloadReporter = (payload: { assetId: string; progress: number }) => void;

type ResourceCacheHookOptions = {
  warn?: ((message: string) => void) | null;
  reportDownloadProgress?: AssetDownloadReporter | null;
};

const defaultWarnHandler = (message: string): void => {
  if (message) {
    console.warn(message);
  }
};

export default class ResourceCache implements MaterialAssetProvider {
  private packageEntries: Map<string, { provider: string; value: string } | null> = new Map();
  private readonly assetEntryCache = new Map<string, Promise<AssetCacheEntry | null>>();
  private document: SceneJsonExportDocument;
  private options: SceneGraphBuildOptions;
  private warn: (message: string) => void;
  private readonly assetLoader: AssetLoader;
  private reportDownloadProgress?: AssetDownloadReporter;

  constructor(
    document: SceneJsonExportDocument,
    options: SceneGraphBuildOptions,
    assetLoader: AssetLoader,
    hooks: ResourceCacheHookOptions = {},
  ) {
    this.document = document;
    this.options = options;
    this.assetLoader = assetLoader;
    this.warn = hooks.warn ?? defaultWarnHandler;
    this.reportDownloadProgress = hooks.reportDownloadProgress ?? undefined;
  }

  setContext(document: SceneJsonExportDocument, options: SceneGraphBuildOptions): void {
    const overridesChanged = this.options?.assetOverrides !== options.assetOverrides;
    this.document = document;
    this.options = options;
    this.packageEntries.clear();
    if (overridesChanged) {
      this.assetEntryCache.clear();
    }
  }

  setHandlers(hooks: ResourceCacheHookOptions): void {
    if (hooks.warn !== undefined) {
      this.warn = hooks.warn ?? defaultWarnHandler;
    }
    if (hooks.reportDownloadProgress !== undefined) {
      this.reportDownloadProgress = hooks.reportDownloadProgress ?? undefined;
    }
  }

  async acquireAssetSource(assetId: string): Promise<MaterialAssetSource | null> {
    const entry = await this.acquireAssetEntry(assetId);
    if (!entry) {
      return null;
    }
    if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
      return { kind: 'arraybuffer', data: entry.arrayBuffer };
    }
    if (entry.blobUrl) {
      return { kind: 'remote-url', url: entry.blobUrl };
    }
    if (entry.downloadUrl) {
      return { kind: 'remote-url', url: entry.downloadUrl };
    }
    return null;
  }

  async acquireAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
    if (!assetId) {
      return null;
    }
    const cached = this.assetLoader.getCache().getEntry(assetId);
    if (cached?.status === 'cached') {
      this.assetLoader.getCache().touch(assetId);
    }
    if (this.assetEntryCache.has(assetId)) {
      return this.assetEntryCache.get(assetId)!;
    }

    const pending = this.resolveAssetSource(assetId)
      .then(async (source) => {
        if (!source) {
          return null;
        }
        try {
          const entry = await this.assetLoader.load(assetId, source, {
            onProgress: (value) => {
              if (!Number.isFinite(value)) {
                return;
              }
              this.reportDownloadProgress?.({
                assetId,
                progress: value,
              });
            },
          });
          this.assetLoader.getCache().registerUsage(assetId);
          return entry;
        } catch (error) {
          console.warn('资源加载失败', assetId, error);
          this.warn(`无法加载资源 ${assetId}`);
          return null;
        }
      })
      .then((entry) => {
        if (!entry) {
          this.assetEntryCache.delete(assetId);
        }
        return entry;
      })
      .catch((error) => {
        console.warn('获取资源来源失败', assetId, error);
        this.warn(`无法解析资源 ${assetId}`);
        this.assetEntryCache.delete(assetId);
        return null;
      });

    this.assetEntryCache.set(assetId, pending);
    return pending;
  }

  private async resolveAssetSource(assetId: string): Promise<AssetSource | null> {
    const override = this.resolveOverride(assetId);
    if (override) {
      return override;
    }

    const embedded = this.resolveEmbedded(assetId);
    if (embedded) {
      return embedded;
    }

    const packageEntry = this.getPackageEntry(assetId);
    if (packageEntry) {
      const resolved = await this.resolvePackageEntry(assetId, packageEntry.provider, packageEntry.value);
      if (resolved) {
        return resolved;
      }
    }

    const assetIndex = this.document.assetIndex as Record<string, any> | undefined;
    const assetInfo = assetIndex && typeof assetIndex === 'object' ? assetIndex[assetId] : undefined;
    const assetSource = assetInfo && typeof assetInfo === 'object' ? assetInfo.source : undefined;
    if (assetSource && typeof assetSource === 'object' && assetSource.type === 'package' && assetSource.providerId) {
      const resolved = await this.resolvePackageEntry(
        assetId,
        assetSource.providerId,
        assetSource.originalAssetId ?? assetId,
      );
      if (resolved) {
        return resolved;
      }
    }

    if (typeof this.options.resolveAssetUrl === 'function') {
      const external = await this.options.resolveAssetUrl(assetId);
      if (external) {
        if (external.startsWith('data:')) {
          return { kind: 'data-url', dataUrl: external };
        }
        return { kind: 'remote-url', url: external };
      }
    }

    this.warn(`未找到资源 ${assetId}`);
    return null;
  }

  private resolveOverride(assetId: string): AssetSource | null {
    const entry = this.options.assetOverrides?.[assetId];
    if (entry == null) {
      return null;
    }
    if (typeof entry === 'string') {
      if (entry.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: entry };
      }
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        return { kind: 'remote-url', url: entry };
      }
      const buffer = this.base64ToArrayBuffer(entry);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
    }
    if (entry instanceof ArrayBuffer) {
      return { kind: 'arraybuffer', data: entry };
    }
    return null;
  }

  private base64ToArrayBuffer(value: string): ArrayBuffer | null {
    try {
      const clean = value.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
      if (typeof atob === 'function') {
        const binary = atob(clean);
        const length = binary.length;
        const buffer = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
          buffer[i] = binary.charCodeAt(i);
        }
        return buffer.buffer;
      }
      if (NodeBuffer) {
        const buf = NodeBuffer.from(clean, 'base64');
        const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        return array;
      }
    } catch (error) {
      console.warn('base64 转换失败', error);
    }
    return null;
  }

  private resolveEmbedded(assetId: string): AssetSource | null {
    const map = this.document.packageAssetMap ?? {};
    const key = `local::${assetId}`;
    const candidate = map[key];
    if (typeof candidate === 'string' && candidate.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: candidate };
    }
    return null;
  }

  private getPackageEntry(assetId: string): { provider: string; value: string } | null {
    if (this.packageEntries.has(assetId)) {
      return this.packageEntries.get(assetId) ?? null;
    }

    const map = this.document.packageAssetMap ?? {};
    const entries = Object.entries(map);
    for (const [key, value] of entries) {
      const separator = key.indexOf('::');
      if (separator === -1) {
        continue;
      }
      const provider = key.slice(0, separator);
      const id = key.slice(separator + 2);
      if (id === assetId && typeof value === 'string') {
        const result = { provider, value };
        this.packageEntries.set(assetId, result);
        return result;
      }
    }

    this.packageEntries.set(assetId, null);
    return null;
  }

  private async resolvePackageEntry(
    assetId: string,
    provider: string,
    value: string,
  ): Promise<AssetSource | null> {
    if (typeof value === 'string' && value.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: value };
    }

    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      return { kind: 'remote-url', url: value };
    }

    if (provider && provider !== 'local' && value) {
      const url = this.buildProviderUrl(provider, value);
      if (url) {
        return { kind: 'remote-url', url };
      }
    }

    if (value) {
      const buffer = this.base64ToArrayBuffer(value);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
    }

    this.warn(`未解析资源映射 ${provider}::${assetId}`);
    return null;
  }

  private buildProviderUrl(provider: string, value: string): string | null {
    if (!value) {
      return null;
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    return null;
  }

}
