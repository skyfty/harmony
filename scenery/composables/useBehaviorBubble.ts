import { reactive, computed, toRefs } from 'vue';
import type { BehaviorRuntimeEvent, BehaviorEventResolution } from '@harmony/schema/behaviors/runtime';

export type BubbleVariant = 'info' | 'success' | 'warning' | 'danger';
export type BubbleAnimation = 'fade' | 'float' | 'scale' | 'shake';
export type BubbleAnchorMode = 'screenFixed' | 'nodeAnchored';

export interface BehaviorBubbleState {
  visible: boolean;
  message: string;
  token: string | null;
  variant: BubbleVariant;
  animation: BubbleAnimation;
  anchorMode: BubbleAnchorMode;
  anchorXPercent: number;
  anchorYPercent: number;
  offsetX: number;
  offsetY: number;
}

export function useBehaviorBubble(deps: {
  resolveBehaviorToken: (token: string, resolution: BehaviorEventResolution) => void;
  loadTextAssetContent: (assetId: string) => Promise<string | null>;
  canPresent: (event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>) => boolean;
  updateAnchorPosition?: (event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>) => void;
}) {
  const state = reactive<BehaviorBubbleState>({
    visible: false,
    message: '',
    token: null,
    variant: 'info',
    animation: 'float',
    anchorMode: 'screenFixed',
    anchorXPercent: 50,
    anchorYPercent: 12,
    offsetX: 0,
    offsetY: -12,
  });

  let delayTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  const seenKeys = new Set<string>();

  const style = computed<Record<string, string>>(() => ({
    left: state.anchorMode === 'nodeAnchored' ? `${state.anchorXPercent}%` : '',
    top: state.anchorMode === 'nodeAnchored' ? `${state.anchorYPercent}%` : '',
    '--behavior-bubble-offset-x': `${state.offsetX}px`,
    '--behavior-bubble-offset-y': `${state.offsetY}px`,
  }));

  function clearTimers(): void {
    if (delayTimer != null) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    if (dismissTimer != null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function clearState(): string | null {
    clearTimers();
    const token = state.token;
    state.visible = false;
    state.message = '';
    state.token = null;
    state.variant = 'info';
    state.animation = 'float';
    state.anchorMode = 'screenFixed';
    state.anchorXPercent = 50;
    state.anchorYPercent = 12;
    state.offsetX = 0;
    state.offsetY = -12;
    return token;
  }

  function dismiss(resolution?: BehaviorEventResolution): void {
    const token = clearState();
    if (resolution && token) {
      deps.resolveBehaviorToken(token, resolution);
    }
  }

  function buildSeenKey(event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>): string {
    return [event.nodeId, event.action, event.behaviorSequenceId, event.behaviorId].join(':');
  }

  async function loadContent(assetId: string, token: string, fallback: string): Promise<void> {
    try {
      const content = await deps.loadTextAssetContent(assetId);
      if (state.token !== token) {
        return;
      }
      state.message = content ?? fallback;
    } catch (error) {
      console.warn('加载行为气泡文本失败', error);
      if (state.token === token) {
        state.message = fallback;
      }
    }
  }

  function present(event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>): void {
    const repeatKey = buildSeenKey(event);
    if (!event.params.repeat && seenKeys.has(repeatKey)) {
      deps.resolveBehaviorToken(event.token, { type: 'continue' });
      return;
    }
    if (!deps.canPresent(event)) {
      deps.resolveBehaviorToken(event.token, { type: 'continue' });
      return;
    }
    dismiss({ type: 'continue' });
    const fallbackMessage = typeof event.params.content === 'string' ? event.params.content : '';
    state.token = event.token;
    state.message = fallbackMessage;
    state.variant = event.params.styleVariant;
    state.animation = event.params.animationPreset;
    state.anchorMode = event.params.anchorMode;
    state.offsetX = event.params.screenOffsetX;
    state.offsetY = event.params.screenOffsetY;
    const contentAssetId = typeof event.params.contentAssetId === 'string' ? event.params.contentAssetId.trim() : '';
    if (contentAssetId) {
      void loadContent(contentAssetId, event.token, fallbackMessage);
    }
    const showBubble = () => {
      if (state.token !== event.token) {
        return;
      }
      state.visible = true;
      if (!event.params.repeat) {
        seenKeys.add(repeatKey);
      }
      const durationMs = Math.max(0, event.params.durationSeconds ?? 0) * 1000;
      if (durationMs <= 0) {
        dismiss({ type: 'continue' });
        return;
      }
      dismissTimer = setTimeout(() => {
        if (state.token === event.token) {
          dismiss({ type: 'continue' });
        }
      }, durationMs);
    };
    const delayMs = Math.max(0, event.params.delaySeconds ?? 0) * 1000;
    if (delayMs <= 0) {
      showBubble();
      return;
    }
    delayTimer = setTimeout(() => {
      delayTimer = null;
      showBubble();
    }, delayMs);
  }

  function cleanup(): void {
    clearTimers();
  }

  return {
    state,
    ...toRefs(state),
    style,
    seenKeys,
    present,
    dismiss,
    clearState,
    cleanup,
  };
}
