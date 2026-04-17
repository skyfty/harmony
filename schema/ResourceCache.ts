import { AssetLoader, type AssetCacheEntry, type AssetLoadPersistenceOptions, type AssetSource } from './assetCache';
import { inferMimeTypeFromAssetId } from './assetTypeConversion';
import { collectAssetRegistryLookupIds, getAssetRegistryCanonicalId } from './assetRegistryLookup';
import { collectBuiltinAssetLookupIds } from './builtinAssetMapping';
import type { SceneGraphBuildOptions } from './sceneGraph';
import { resolveServerAssetDownloadUrl } from './serverAssetUrl';
import type {
  SceneAssetOverrideEntry,
  SceneAssetRegistryEntry,
  SceneJsonExportDocument,
} from './index';

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

export default class ResourceCache {
  private readonly assetEntryCache = new Map<string, Promise<AssetCacheEntry | null>>();
  private document: SceneJsonExportDocument;
  private options: SceneGraphBuildOptions;
  private readonly assetLoader: AssetLoader;
  private reportDownloadProgress: AssetDownloadReporter | undefined;

  constructor(
    document: SceneJsonExportDocument,
    options: SceneGraphBuildOptions,
    assetLoader: AssetLoader,
    hooks: ResourceCacheHookOptions = {},
  ) {
    this.document = document;
    this.options = options;
    this.assetLoader = assetLoader;
    this.reportDownloadProgress = hooks.reportDownloadProgress ?? undefined;
  }

  setContext(document: SceneJsonExportDocument, options: SceneGraphBuildOptions): void {
    const documentOverridesChanged =
      this.document?.assetRegistry !== document.assetRegistry ||
      this.document?.projectOverrideAssets !== document.projectOverrideAssets ||
      this.document?.sceneOverrideAssets !== document.sceneOverrideAssets ||
      this.document?.assetUrlOverrides !== document.assetUrlOverrides;
    const overridesChanged =
      this.options?.assetOverrides !== options.assetOverrides ||
      this.options?.builtinAssetPathMap !== options.builtinAssetPathMap ||
      this.options?.resolveBuiltinAssetPath !== options.resolveBuiltinAssetPath;
    this.document = document;
    this.options = options;
    if (overridesChanged || documentOverridesChanged) {
      this.assetEntryCache.clear();
    }
  }

  setHandlers(hooks: ResourceCacheHookOptions): void {

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
    if (entry.blobUrl) {
      return { kind: 'remote-url', url: entry.blobUrl };
    }
    if (entry.blob) {
      return {
        kind: 'blob',
        blob: entry.blob,
        mimeType: entry.mimeType,
        filename: entry.filename,
      };
    }
    return null;
  }

  async acquireAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
    if (!assetId) {
      return null;
    }

    // Fast path: if we already have an in-flight resolve/load, reuse it.
    // This avoids duplicate IndexedDB hydration calls in StoreBackedAssetCache.
    if (this.assetEntryCache.has(assetId)) {
      return this.assetEntryCache.get(assetId)!;
    }

    const lookupAssetIds = this.collectAssetLookupIds(assetId);
    const persistence = this.resolveAssetPersistence(assetId, lookupAssetIds);

    const cached = await this.assetLoader.getCache().getEntry(assetId);
    if (cached?.status === 'cached') {
      this.assetLoader.getCache().touch(assetId);
      return cached;
    }

    const hydrated = await this.assetLoader.getCache().hydrateFromPersistent(assetId, persistence)
    if (hydrated?.status === 'cached') {
      this.assetLoader.getCache().touch(assetId)
      return hydrated
    }

    const pending = this.resolveAssetSource(assetId, lookupAssetIds)
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
            persistence,
          });
          this.assetLoader.getCache().touch(assetId);
          return entry;
        } catch (error) {
          console.warn('资源加载失败', assetId, error);
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
        this.assetEntryCache.delete(assetId);
        return null;
      });

    this.assetEntryCache.set(assetId, pending);
    return pending;
  }

  private async resolveAssetSource(assetId: string, lookupAssetIds?: string[]): Promise<AssetSource | null> {
    if (!assetId) {
      return null;
    }

    const resolvedLookupAssetIds = lookupAssetIds ?? this.collectAssetLookupIds(assetId);

    if (assetId.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: assetId };
    }

    for (const lookupAssetId of resolvedLookupAssetIds) {
      const override = this.resolveOverride(lookupAssetId);
      if (override) {
        return override;
      }
    }

    for (const lookupAssetId of resolvedLookupAssetIds) {
      const registryResolved = await this.resolveFromUnifiedAssetRegistry(lookupAssetId);
      if (registryResolved) {
        return registryResolved;
      }
    }

    const documentOverride = this.resolveDocumentAssetUrlOverride(resolvedLookupAssetIds);
    if (documentOverride) {
      return documentOverride;
    }

    const builtinMappedPath = await this.resolveBuiltinMappedPath(resolvedLookupAssetIds);
    if (builtinMappedPath) {
      return builtinMappedPath;
    }

    // Remote URL should be resolved only after overrides, so embedded packages can override URL-like IDs.
    if (this.isRemoteUrl(assetId)) {
      return { kind: 'remote-url', url: assetId };
    }

    return null;
  }

  private resolveAssetPersistence(assetId: string, assetIds: string[]): AssetLoadPersistenceOptions {
    for (const candidateId of assetIds) {
      const descriptor = this.resolveEffectiveAssetDescriptor(candidateId);
      if (!descriptor) {
        continue;
      }
      return {
        contentHash: typeof (descriptor as any).contentHash === 'string' ? (descriptor as any).contentHash : null,
        contentHashAlgorithm: typeof (descriptor as any).contentHashAlgorithm === 'string'
          ? (descriptor as any).contentHashAlgorithm
          : null,
      };
    }
    return {
      keys: [assetId],
    };
  }

  private async resolveFromUnifiedAssetRegistry(assetId: string): Promise<AssetSource | null> {
    const descriptor = this.resolveEffectiveAssetDescriptor(assetId);
    if (!descriptor) {
      return null;
    }

    if (descriptor.sourceType === 'url') {
      const candidate = this.pickUrlCandidate(descriptor.url, (descriptor as any).downloadUrl);
      if (!candidate) {
        return null;
      }
      if (candidate.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: candidate };
      }
      return { kind: 'remote-url', url: candidate };
    }

    if (descriptor.sourceType === 'server') {
      const directUrl = resolveServerAssetDownloadUrl({
        assetBaseUrl: this.options.serverAssetBaseUrl,
        fileKey: typeof (descriptor as any).fileKey === 'string' ? (descriptor as any).fileKey : null,
        resolvedUrl: descriptor.resolvedUrl,
        downloadUrl: typeof (descriptor as any).downloadUrl === 'string' ? (descriptor as any).downloadUrl : null,
        url: typeof (descriptor as any).url === 'string' ? (descriptor as any).url : null,
      });
      if (directUrl) {
        if (directUrl.startsWith('data:')) {
          return { kind: 'data-url', dataUrl: directUrl };
        }
        return { kind: 'remote-url', url: directUrl };
      }
      return null;
    }

    const inline = typeof descriptor.inline === 'string' ? descriptor.inline.trim() : '';
    if (inline.length) {
      const inlineResolved = this.resolveInlineStringAsset(assetId, inline);
      if (inlineResolved) {
        return inlineResolved;
      }
    }

    const zipPath = typeof descriptor.zipPath === 'string' ? descriptor.zipPath.trim() : '';
    if (!zipPath.length) {
      return null;
    }
    if (zipPath.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: zipPath };
    }
    if (this.isRemoteUrl(zipPath) || zipPath.startsWith('/')) {
      return { kind: 'remote-url', url: zipPath };
    }

    return null;
  }

  private resolveEffectiveAssetDescriptor(assetId: string): SceneAssetRegistryEntry | null {
    const candidateIds = collectAssetRegistryLookupIds(
      assetId,
      this.document.sceneOverrideAssets,
      this.document.projectOverrideAssets,
      this.document.assetRegistry,
    );

    for (const candidateId of candidateIds) {
      const sceneOverride = this.resolveOverrideEntry(this.document.sceneOverrideAssets?.[candidateId]);
      if (sceneOverride) {
        return sceneOverride;
      }
    }

    for (const candidateId of candidateIds) {
      const projectOverride = this.resolveOverrideEntry(this.document.projectOverrideAssets?.[candidateId]);
      if (projectOverride) {
        return projectOverride;
      }
    }

    for (const candidateId of candidateIds) {
      const registryEntry = this.resolveRegistryEntry(this.document.assetRegistry?.[candidateId]);
      if (registryEntry) {
        return registryEntry;
      }
    }

    const canonicalAssetId = getAssetRegistryCanonicalId(
      assetId,
      this.document.sceneOverrideAssets,
      this.document.projectOverrideAssets,
      this.document.assetRegistry,
    );
    if (canonicalAssetId && canonicalAssetId !== assetId) {
      const sceneOverride = this.resolveOverrideEntry(this.document.sceneOverrideAssets?.[canonicalAssetId]);
      if (sceneOverride) {
        return sceneOverride;
      }
      const projectOverride = this.resolveOverrideEntry(this.document.projectOverrideAssets?.[canonicalAssetId]);
      if (projectOverride) {
        return projectOverride;
      }
      return this.resolveRegistryEntry(this.document.assetRegistry?.[canonicalAssetId]);
    }

    return null;
  }

  private resolveOverrideEntry(entry: SceneAssetOverrideEntry | undefined): SceneAssetRegistryEntry | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    return this.resolveRegistryEntry(entry);
  }

  private resolveRegistryEntry(entry: SceneAssetRegistryEntry | undefined): SceneAssetRegistryEntry | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const sourceType = entry.sourceType;
    if (sourceType !== 'server' && sourceType !== 'package' && sourceType !== 'url') {
      return null;
    }
    return entry;
  }

  private collectAssetLookupIds(assetId: string): string[] {
    const ids = new Set<string>();
    const primary = typeof assetId === 'string' ? assetId.trim() : '';
    if (primary.length) {
      ids.add(primary);
    }
    collectAssetRegistryLookupIds(
      primary,
      this.document.sceneOverrideAssets,
      this.document.projectOverrideAssets,
      this.document.assetRegistry,
    ).forEach((candidateId) => ids.add(candidateId));
    const builtinLookups = collectBuiltinAssetLookupIds(primary);
    for (const item of builtinLookups) {
      const normalized = typeof item === 'string' ? item.trim() : '';
      if (normalized.length) {
        ids.add(normalized);
      }
    }
    return Array.from(ids);
  }

  private resolveDocumentAssetUrlOverride(assetIds: string[]): AssetSource | null {
    const overrides = this.document.assetUrlOverrides;
    if (!overrides || typeof overrides !== 'object') {
      return null;
    }

    for (const assetId of assetIds) {
      const candidate = overrides[assetId];
      if (typeof candidate !== 'string') {
        continue;
      }
      const value = candidate.trim();
      if (!value.length) {
        continue;
      }
      if (value.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: value };
      }
      return { kind: 'remote-url', url: value };
    }

    return null;
  }

  private async resolveBuiltinMappedPath(assetIds: string[]): Promise<AssetSource | null> {
    const map = this.options.builtinAssetPathMap;
    if (map && typeof map === 'object') {
      for (const assetId of assetIds) {
        const candidate = map[assetId];
        const resolved = this.resolveMappedPathSource(candidate);
        if (resolved) {
          return resolved;
        }
      }
    }

    const resolver = this.options.resolveBuiltinAssetPath;
    if (typeof resolver === 'function') {
      for (const assetId of assetIds) {
        const candidate = await resolver(assetId);
        const resolved = this.resolveMappedPathSource(candidate);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private resolveMappedPathSource(candidate: string | null | undefined): AssetSource | null {
    if (typeof candidate !== 'string') {
      return null;
    }
    const value = candidate.trim();
    if (!value.length) {
      return null;
    }
    if (value.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: value };
    }
    return { kind: 'remote-url', url: value };
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

    if (typeof entry === 'object') {
      const bytes = (entry as any).bytes as ArrayBuffer | Uint8Array | undefined;
      if (bytes) {
        const filename = typeof (entry as any).filename === 'string' ? (entry as any).filename : null;
        const hintedMime = typeof (entry as any).mimeType === 'string' ? (entry as any).mimeType : null;
        const fallbackMime = filename ? inferMimeTypeFromAssetId(filename) : inferMimeTypeFromAssetId(assetId);
        const mimeType = hintedMime ?? fallbackMime ?? 'application/octet-stream';
        const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        // Ensure we always end up with an ArrayBuffer-backed view (BlobPart typing rejects SharedArrayBuffer).
        const safeArrayBuffer = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(safeArrayBuffer).set(buffer);
        const safeBuffer = new Uint8Array(safeArrayBuffer);
        try {
          const blob = new Blob([safeBuffer], { type: mimeType });
          return {
            kind: 'blob',
            blob,
            mimeType,
            filename: filename ?? null,
          };
        } catch (_error) {
          // Fallback for environments without Blob: provide raw bytes.
          return {
            kind: 'arraybuffer',
            data: safeArrayBuffer,
            mimeType,
          };
        }
      }
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
          mimeType: inferMimeTypeFromAssetId(assetId),
        };
      }
      const encoded = this.encodeInlineText(value);
      if (encoded) {
        return {
          kind: 'arraybuffer',
          data: encoded,
          mimeType: inferMimeTypeFromAssetId(assetId) ?? 'text/plain',
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

  // use shared `inferMimeTypeFromAssetId` from assetTypeConversion

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
