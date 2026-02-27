type SystemInfoRecord = Record<string, unknown>;

type UniApiLike = {
  getWindowInfo?: () => SystemInfoRecord;
  getDeviceInfo?: () => SystemInfoRecord;
  getAppBaseInfo?: () => SystemInfoRecord;
};

type WxApiLike = {
  getWindowInfo?: () => SystemInfoRecord;
  getDeviceInfo?: () => SystemInfoRecord;
  getAppBaseInfo?: () => SystemInfoRecord;
};

function safeCall<T>(callable?: () => T): T | null {
  if (typeof callable !== 'function') {
    return null;
  }
  try {
    return callable();
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function resolveUniApi(): UniApiLike {
  return uni as unknown as UniApiLike;
}

function resolveWxApi(): WxApiLike | undefined {
  return (globalThis as typeof globalThis & { wx?: WxApiLike }).wx;
}

function getWindowInfoRecord(): SystemInfoRecord | null {
  const uniApi = resolveUniApi();
  const wxApi = resolveWxApi();
  return safeCall(uniApi.getWindowInfo) ?? safeCall(wxApi?.getWindowInfo);
}

function getDeviceInfoRecord(): SystemInfoRecord | null {
  const uniApi = resolveUniApi();
  const wxApi = resolveWxApi();
  return safeCall(uniApi.getDeviceInfo) ?? safeCall(wxApi?.getDeviceInfo);
}

function getAppBaseInfoRecord(): SystemInfoRecord | null {
  const uniApi = resolveUniApi();
  const wxApi = resolveWxApi();
  return safeCall(uniApi.getAppBaseInfo) ?? safeCall(wxApi?.getAppBaseInfo);
}

export function getStatusBarHeight(fallback = 0): number {
  const windowInfo = getWindowInfoRecord();
  const appBaseInfo = getAppBaseInfoRecord();
  const statusBarHeight = toFiniteNumber(windowInfo?.statusBarHeight ?? appBaseInfo?.statusBarHeight);
  if (statusBarHeight === null || statusBarHeight < 0) {
    return fallback;
  }
  return statusBarHeight;
}

export function getViewportSize(defaultSize: { width: number; height: number }): { width: number; height: number } {
  const windowInfo = getWindowInfoRecord();
  const width = toFiniteNumber(windowInfo?.windowWidth ?? windowInfo?.screenWidth);
  const height = toFiniteNumber(windowInfo?.windowHeight ?? windowInfo?.screenHeight);

  return {
    width: width && width > 0 ? width : defaultSize.width,
    height: height && height > 0 ? height : defaultSize.height,
  };
}

export function getDevicePixelRatio(fallback = 1): number {
  const deviceInfo = getDeviceInfoRecord();
  const windowInfo = getWindowInfoRecord();
  const pixelRatio = toFiniteNumber(deviceInfo?.pixelRatio ?? windowInfo?.pixelRatio);
  if (pixelRatio === null || pixelRatio <= 0) {
    return fallback;
  }
  return pixelRatio;
}

export function isWeChatMiniProgramRuntime(): boolean {
  const wxApi = resolveWxApi();
  return Boolean(
    wxApi
    && (
      typeof wxApi.getDeviceInfo === 'function'
      || typeof wxApi.getWindowInfo === 'function'
      || typeof wxApi.getAppBaseInfo === 'function'
    ),
  );
}