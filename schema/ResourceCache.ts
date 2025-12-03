import { AssetLoader, type AssetCacheEntry, type AssetSource } from './assetCache';
import type { SceneGraphBuildOptions } from './sceneGraph';
import type { SceneJsonExportDocument } from '@harmony/schema';

const NodeBuffer: { from: (data: string, encoding: string) => any } | undefined =
  typeof globalThis !== 'undefined' && (globalThis as any).Buffer
    ? (globalThis as any).Buffer
    : undefined;

const REMOTE_URL_PATTERN = /^(https?:)?\/\//i;
const sharedTextEncoder: TextEncoder | null =
  typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

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

export default class ResourceCache {
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

  async acquireAssetSource(assetId: string): Promise<AssetSource | null> {
    const entry = await this.acquireAssetEntry(assetId);
    if (!entry) {
      return null;
    }
    if (entry.downloadUrl) {
      return { kind: 'remote-url', url: entry.downloadUrl };
    }
    if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
      return { kind: 'arraybuffer', data: entry.arrayBuffer };
    }
    if (entry.blobUrl) {
      return { kind: 'remote-url', url: entry.blobUrl };
    }
    return null;
  }

  async acquireAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
    if (!assetId) {
      return null;
    }
    const cached = await this.assetLoader.getCache().getEntry(assetId);
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
          this.assetLoader.getCache().touch(assetId);
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
    if (!assetId) {
      return null;
    }

    if (this.isRemoteUrl(assetId)) {
      return { kind: 'remote-url', url: assetId };
    }

    if (assetId.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: assetId };
    }

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

    const indexSource = await this.resolveAssetIndexSource(assetId);
    if (indexSource) {
      return indexSource;
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
      if (this.isRemoteUrl(entry)) {
        return { kind: 'remote-url', url: entry };
      }
      const buffer = this.base64ToArrayBuffer(entry);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
      const encoded = this.encodeInlineText(entry);
      if (encoded) {
        return { kind: 'arraybuffer', data: encoded };
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
    const keys = [`local::${assetId}`, assetId];
    for (const key of keys) {
      const candidate = map[key];
      if (typeof candidate !== 'string') {
        continue;
      }
      const resolved = this.resolveInlineStringAsset(assetId, candidate);
      if (resolved) {
        return resolved;
      }
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

    const map = this.document.packageAssetMap ?? {};
    const key = `url::${assetId}`;
    const candidate = map[key];
    if (typeof candidate === 'string') {
      return { kind: 'remote-url', url: candidate };
    }
    if (value) {
      const buffer = this.base64ToArrayBuffer(value);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
      const encoded = this.encodeInlineText(value);
      if (encoded) {
        return {
          kind: 'arraybuffer',
          data: encoded,
          mimeType: this.inferMimeTypeFromAssetId(assetId),
        };
      }
    }

    this.warn(`未解析资源映射 ${provider}::${assetId}`);
    return null;
  }

  private async resolveAssetIndexSource(assetId: string): Promise<AssetSource | null> {
    const assetIndex = this.document.assetIndex as Record<string, any> | undefined;
    if (!assetIndex || typeof assetIndex !== 'object') {
      return null;
    }
    const entry = assetIndex[assetId];
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const inlineValue = typeof entry.inline === 'string' ? entry.inline.trim() : '';
    if (inlineValue) {
      const resolvedInline = this.resolveInlineStringAsset(assetId, inlineValue);
      if (resolvedInline) {
        return resolvedInline;
      }
    }

    const directUrl = this.pickUrlCandidate(entry.url, entry.downloadUrl);
    if (directUrl) {
      return { kind: 'remote-url', url: directUrl };
    }

    const source = entry.source;
    if (source && typeof source === 'object') {
      const sourceInline = typeof source.inline === 'string' ? source.inline.trim() : '';
      if (sourceInline) {
        const resolvedInline = this.resolveInlineStringAsset(assetId, sourceInline);
        if (resolvedInline) {
          return resolvedInline;
        }
      }

      const sourceUrl = this.pickUrlCandidate(source.url, source.downloadUrl);
      if (sourceUrl) {
        return { kind: 'remote-url', url: sourceUrl };
      }

      const providerId = typeof source.providerId === 'string' ? source.providerId.trim() : '';
      const originalAssetId =
        typeof source.originalAssetId === 'string' && source.originalAssetId.trim().length
          ? source.originalAssetId.trim()
          : assetId;
      const providerValue = typeof source.value === 'string' ? source.value.trim() : '';

      if (providerId) {
        const map = this.document.packageAssetMap ?? {};
        const mapped = map[`${providerId}::${originalAssetId}`];
        const candidate =
          typeof mapped === 'string' && mapped.trim().length ? mapped.trim() : providerValue || originalAssetId;
        const resolved = await this.resolvePackageEntry(originalAssetId, providerId, candidate);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private resolveInlineStringAsset(assetId: string, rawValue: string): AssetSource | null {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value.length) {
      return null;
    }
    if (value.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: value };
    }
    if (this.isRemoteUrl(value)) {
      return { kind: 'remote-url', url: value };
    }
    const buffer = this.base64ToArrayBuffer(value);
    if (buffer) {
      return {
        kind: 'arraybuffer',
        data: buffer,
        mimeType: this.inferMimeTypeFromAssetId(assetId),
      };
    }
    const encoded = this.encodeInlineText(value);
    if (encoded) {
      return {
        kind: 'arraybuffer',
        data: encoded,
        mimeType: this.inferMimeTypeFromAssetId(assetId) ?? 'text/plain',
      };
    }
    return null;
  }

  private encodeInlineText(value: string): ArrayBuffer | null {
    if (!value.length) {
      return null;
    }
    try {
      if (sharedTextEncoder) {
        return sharedTextEncoder.encode(value).buffer;
      }
      if (NodeBuffer) {
        const buf = NodeBuffer.from(value, 'utf-8');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    } catch (error) {
      console.warn('文本资源编码失败', error);
    }
    return null;
  }

  private inferMimeTypeFromAssetId(assetId: string | undefined): string | null {
    if (!assetId) {
      return null;
    }
    const lower = assetId.toLowerCase();
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.svg')) {
      return 'image/svg+xml';
    }
    if (lower.endsWith('.json')) {
      return 'application/json';
    }
    if (lower.endsWith('.txt')) {
      return 'text/plain';
    }
    return null;
  }

  private pickUrlCandidate(...candidates: Array<unknown>): string | null {
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const trimmed = candidate.trim();
      if (trimmed.length) {
        return trimmed;
      }
    }
    return null;
  }

  private isRemoteUrl(value: string): boolean {
    return REMOTE_URL_PATTERN.test(value);
  }
}
