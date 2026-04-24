type ShareApp = {
  mixin: (mixinOptions: Record<string, unknown>) => void;
};

export type ShareMessage = {
  title: string;
  path: string;
  imageUrl?: string;
};

export type ShareTimelineMessage = {
  title: string;
  query: string;
  imageUrl?: string;
};

type ShareContext = {
  title?: string;
  path?: string;
  query?: Record<string, string>;
};

const defaultHomeShare: ShareMessage = {
  title: '探索你想去的景点',
  path: '/pages/home/index',
};

const defaultHomeTimelineQuery = '__shareTarget=home';

let sceneryShareContext: ShareContext | null = null;

function getUniApi(): {
  showShareMenu?: (options: { menus?: string[] }) => unknown;
  reLaunch?: (options: { url: string }) => unknown;
} {
  return globalThis as typeof globalThis & {
    showShareMenu?: (options: { menus?: string[] }) => unknown;
    reLaunch?: (options: { url: string }) => unknown;
  } as unknown as {
    showShareMenu?: (options: { menus?: string[] }) => unknown;
    reLaunch?: (options: { url: string }) => unknown;
  };
}

function getCurrentRoute(): string {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const currentPage = pages.length > 0 ? pages[pages.length - 1] : null;
  return typeof currentPage?.route === 'string' ? currentPage.route : '';
}

function buildQueryString(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, value]) => String(value).length > 0);
  if (entries.length === 0) {
    return '';
  }

  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `?${query}`;
}

function buildShareMessage(): ShareMessage {
  const currentRoute = getCurrentRoute();
  if (currentRoute === 'pages/scenery/index' && sceneryShareContext) {
    const path = sceneryShareContext.path
      || `/pages/scenery/index${buildQueryString(sceneryShareContext.query ?? {})}`;
    return {
      title: sceneryShareContext.title || defaultHomeShare.title,
      path,
    };
  }

  return defaultHomeShare;
}

function buildTimelineMessage(): ShareTimelineMessage {
  const currentRoute = getCurrentRoute();
  if (currentRoute === 'pages/scenery/index' && sceneryShareContext) {
    const query = buildQueryString(sceneryShareContext.query ?? {}).replace(/^\?/, '');
    return {
      title: sceneryShareContext.title || defaultHomeShare.title,
      query,
    };
  }

  return {
    title: defaultHomeShare.title,
    query: defaultHomeTimelineQuery,
  };
}

function handleShareLaunch(query: Record<string, unknown> | undefined): void {
  if (!query || query.__shareTarget !== 'home') {
    return;
  }

  const currentRoute = getCurrentRoute();
  if (currentRoute === 'pages/home/index') {
    return;
  }

  getUniApi().reLaunch?.({ url: '/pages/home/index' });
}

export function setSceneryShareContext(context: ShareContext): void {
  sceneryShareContext = context;
}

export function clearSceneryShareContext(): void {
  sceneryShareContext = null;
}

export function installShareSupport(app: ShareApp): void {
  app.mixin({
    onLoad(query?: Record<string, unknown>) {
      handleShareLaunch(query);
    },
    onShow() {
      getUniApi().showShareMenu?.({
        menus: ['shareAppMessage', 'shareTimeline'],
      });
    },
    onShareAppMessage() {
      return buildShareMessage();
    },
    onShareTimeline() {
      return buildTimelineMessage();
    },
  });
}
