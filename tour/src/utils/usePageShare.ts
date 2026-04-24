import { onShareAppMessage } from '@dcloudio/uni-app';
import { ref } from 'vue';

export type PageShareInfo = {
  title?: string;
  path?: string;
  imageUrl?: string | null;
};

function normalizeShareInfo(info?: PageShareInfo): Required<PageShareInfo> {
  return {
    title: info?.title ?? '',
    path: info?.path ?? '',
    imageUrl: info?.imageUrl ?? null,
  };
}

export function usePageShare(defaultInfo?: PageShareInfo) {
  const last = ref<Required<PageShareInfo>>(normalizeShareInfo(defaultInfo));

  function registerShare(getShareInfo?: (() => PageShareInfo | null | undefined) | null): void {
    if (typeof uni.showShareMenu === 'function') {
      void uni.showShareMenu({
        menus: ['shareAppMessage'],
      });
    }

    onShareAppMessage(() => {
      try {
        const info = typeof getShareInfo === 'function' ? getShareInfo() : null;

        if (info?.title) {
          last.value.title = info.title;
        }
        if (info?.path) {
          last.value.path = info.path;
        }
        if (typeof info?.imageUrl !== 'undefined') {
          last.value.imageUrl = info.imageUrl ?? null;
        }

        return {
          title: info?.title || last.value.title || '',
          path: info?.path || last.value.path || '',
          imageUrl: info?.imageUrl || undefined,
        };
      } catch {
        return {
          title: last.value.title || '',
          path: last.value.path || '',
        };
      }
    });
  }

  return {
    registerShare,
    last,
  };
}

export default usePageShare;