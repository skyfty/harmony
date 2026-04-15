import { reactive } from 'vue';

export type LanternTextState = { text: string; loading: boolean; error: string | null };
export type LanternImageState = { url: string | null; loading: boolean; error: string | null };

export function useLanternAssets(deps: {
  loadTextAssetContent: (assetId: string) => Promise<string | null>;
  resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string; mimeType?: string | null } | null>;
}) {
  const lanternTextState = reactive<Record<string, LanternTextState>>({});
  const lanternTextPromises = new Map<string, Promise<void>>();
  const lanternImageState = reactive<Record<string, LanternImageState>>({});
  const lanternImagePromises = new Map<string, Promise<void>>();

  function getLanternTextState(assetId: string): LanternTextState {
    if (!lanternTextState[assetId]) {
      lanternTextState[assetId] = reactive({
        text: '',
        loading: false,
        error: null,
      }) as LanternTextState;
    }
    return lanternTextState[assetId];
  }

  function getLanternImageState(assetId: string): LanternImageState {
    if (!lanternImageState[assetId]) {
      lanternImageState[assetId] = reactive({
        url: null,
        loading: false,
        error: null,
      }) as LanternImageState;
    }
    return lanternImageState[assetId];
  }

  async function ensureLanternText(assetId: string): Promise<void> {
    const trimmed = assetId.trim();
    if (!trimmed.length) {
      return;
    }
    if (lanternTextPromises.has(trimmed)) {
      await lanternTextPromises.get(trimmed);
      return;
    }
    const promise = (async () => {
      const state = getLanternTextState(trimmed);
      state.loading = true;
      state.error = null;
      try {
        const text = await deps.loadTextAssetContent(trimmed);
        state.text = text ?? '';
        if (text == null) {
          state.error = '内容加载失败';
        }
      } catch (error) {
        console.warn('加载幻灯片文本失败', error);
        state.error = error instanceof Error ? error.message : '内容加载失败';
        state.text = '';
      } finally {
        state.loading = false;
        lanternTextPromises.delete(trimmed);
      }
    })();
    lanternTextPromises.set(trimmed, promise);
    await promise;
  }

  async function ensureLanternImage(assetId: string): Promise<void> {
    const trimmed = assetId.trim();
    if (!trimmed.length) {
      return;
    }
    if (lanternImagePromises.has(trimmed)) {
      await lanternImagePromises.get(trimmed);
      return;
    }
    const promise = (async () => {
      const state = getLanternImageState(trimmed);
      state.loading = true;
      state.error = null;
      try {
        const resolved = await deps.resolveAssetUrlFromCache(trimmed);
        if (!resolved) {
          throw new Error('无法解析图片资源');
        }
        state.url = resolved.url;
      } catch (error) {
        state.error = (error as Error).message ?? '图片资源加载失败';
        state.url = null;
      } finally {
        state.loading = false;
        lanternImagePromises.delete(trimmed);
      }
    })();
    lanternImagePromises.set(trimmed, promise);
    await promise;
  }

  function pruneActiveAssets(activeTextIds: Set<string>, activeImageIds: Set<string>): void {
    Object.keys(lanternTextState).forEach((key) => {
      if (!activeTextIds.has(key)) {
        delete lanternTextState[key];
      }
    });
    Object.keys(lanternImageState).forEach((key) => {
      if (!activeImageIds.has(key)) {
        delete lanternImageState[key];
      }
    });
    Array.from(lanternTextPromises.keys()).forEach((key) => {
      if (!activeTextIds.has(key)) {
        lanternTextPromises.delete(key);
      }
    });
    Array.from(lanternImagePromises.keys()).forEach((key) => {
      if (!activeImageIds.has(key)) {
        lanternImagePromises.delete(key);
      }
    });
  }

  return {
    lanternTextState,
    lanternTextPromises,
    lanternImageState,
    lanternImagePromises,
    getLanternTextState,
    getLanternImageState,
    ensureLanternText,
    ensureLanternImage,
    pruneActiveAssets,
  };
}
