import { reactive, toRefs } from 'vue';
import type { BehaviorRuntimeEvent, BehaviorEventResolution } from '@harmony/schema/behaviors/runtime';

export interface BehaviorAlertState {
  visible: boolean;
  title: string;
  message: string;
  token: string | null;
  showConfirm: boolean;
  showCancel: boolean;
  confirmText: string;
  cancelText: string;
}

export function useBehaviorAlert(deps: {
  resolveBehaviorToken: (token: string, resolution: BehaviorEventResolution) => void;
  loadTextAssetContent: (assetId: string) => Promise<string | null>;
}) {
  const state = reactive<BehaviorAlertState>({
    visible: false,
    title: '',
    message: '',
    token: null,
    showConfirm: true,
    showCancel: false,
    confirmText: '确定',
    cancelText: '取消',
  });

  function close(): void {
    state.visible = false;
    state.title = '';
    state.message = '';
    state.token = null;
    state.showConfirm = true;
    state.showCancel = false;
    state.confirmText = '确定';
    state.cancelText = '取消';
  }

  async function loadAlertContent(assetId: string, token: string, fallback: string): Promise<void> {
    try {
      const content = await deps.loadTextAssetContent(assetId);
      if (state.token !== token) {
        return;
      }
      state.message = content ?? fallback;
    } catch (error) {
      console.warn('加载行为弹窗文本失败', error);
      if (state.token === token) {
        state.message = fallback;
      }
    }
  }

  function present(event: Extract<BehaviorRuntimeEvent, { type: 'show-alert' }>): void {
    state.token = event.token;
    const legacyParams = event.params as typeof event.params & { title?: string; message?: string };
    const anyParams = event.params as unknown as Record<string, unknown>;
    const rawTitle = typeof anyParams.title === 'string' ? anyParams.title : legacyParams.title;
    const title = typeof rawTitle === 'string' && rawTitle.trim().length ? rawTitle.trim() : '提示';
    const legacyMessage = typeof legacyParams.message === 'string' ? legacyParams.message : '';
    const contentParam = typeof anyParams.content === 'string' ? (anyParams.content as string) : undefined;
    const messageFallback = typeof contentParam === 'string' ? contentParam : legacyMessage;
    state.title = title;
    state.message = messageFallback;
    state.showConfirm = event.params.showConfirm ?? true;
    state.showCancel = event.params.showCancel ?? false;
    state.confirmText = (event.params.confirmText ?? '确定') || '确定';
    state.cancelText = (event.params.cancelText ?? '取消') || '取消';
    const contentAssetId = (event.params as { contentAssetId?: string | null }).contentAssetId;
    if (typeof contentAssetId === 'string' && contentAssetId.trim().length) {
      void loadAlertContent(contentAssetId.trim(), event.token, messageFallback);
    }
    if (!state.showConfirm && !state.showCancel) {
      deps.resolveBehaviorToken(event.token, { type: 'continue' });
      return;
    }
    state.visible = true;
  }

  function confirm(): void {
    const token = state.token;
    if (!token) {
      return;
    }
    try {
      deps.resolveBehaviorToken(token, { type: 'continue' });
    } finally {
      close();
    }
  }

  function cancel(): void {
    const token = state.token;
    if (!token) {
      return;
    }
    try {
      deps.resolveBehaviorToken(token, { type: 'abort', message: '用户取消了提示框' });
    } finally {
      close();
    }
  }

  return {
    state,
    ...toRefs(state),
    present,
    confirm,
    cancel,
    close,
  };
}
