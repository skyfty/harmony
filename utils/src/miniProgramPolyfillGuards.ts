/**
 * Runtime guards for the mini-program DOM polyfills.
 *
 * `@minisheep/mini-program-polyfill-core` replaces `globalThis.TextDecoder`
 * with its own implementation. That implementation expects a byte source and
 * reads `input.length` right away, so the standard argument-less
 * `decoder.decode()` call (the one every wasm-bindgen glue module performs to
 * reset its cached decoder) throws:
 *
 *   TypeError: Cannot read properties of undefined (reading 'length')
 *
 * `@sparkjsdev/spark` bundles such a glue module, and the Gaussian splat
 * runtime is imported by the scene schema graph. The throw therefore happened
 * while the schema chunk was being evaluated, which aborted the whole module
 * queue: `SceneryViewer` never registered and the mini program reported
 * `Component is not found in path ".../components/SceneryViewer"`.
 *
 * The same runtime also reads `navigator.platform` and
 * `navigator.userAgent` while constructing the Spark renderer. The WeChat
 * app-service global has no `navigator`, so install a small, stable
 * mini-program navigator object here as well.
 *
 * Import this module and call {@link installMiniProgramPolyfillGuards} once in
 * the mini-program entry (`main.ts`), directly after the polyfill import and
 * before any page or shared chunk is evaluated.
 */

type TextDecoderDecodeOptions = { stream?: boolean };

type TextDecoderLike = {
  decode(input?: ArrayBuffer | ArrayBufferView | ArrayLike<number> | null, options?: TextDecoderDecodeOptions): string;
};

type TextDecoderConstructor = {
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoderLike;
  prototype: TextDecoderLike;
};

const TEXT_DECODER_PATCH_FLAG = '__harmonyTextDecoderDecodeGuard';

type MiniProgramNavigator = {
  platform: string;
  userAgent: string;
  maxTouchPoints: number;
  xr?: unknown;
};

type MiniProgramDeviceInfo = {
  platform?: string;
  system?: string;
  model?: string;
  brand?: string;
};

type MiniProgramNavigatorScope = {
  navigator?: Partial<MiniProgramNavigator>;
  wx?: {
    getDeviceInfo?: () => MiniProgramDeviceInfo;
    getSystemInfoSync?: () => MiniProgramDeviceInfo;
  };
};

/**
 * Make the mini-program `TextDecoder` polyfill tolerate an omitted input.
 *
 * Native `TextDecoder#decode()` accepts being called without arguments (it
 * returns the empty string), so this only restores spec behaviour that the
 * polyfill is missing. Also installs the minimal `navigator` fields consumed
 * by Three.js/Spark in the app-service environment. Returns whether any patch
 * was installed.
 */
export function installMiniProgramPolyfillGuards(): boolean {
  const textDecoderPatched = patchTextDecoderDecode();
  const navigatorPatched = installMiniProgramNavigator();
  return textDecoderPatched || navigatorPatched;
}

function installMiniProgramNavigator(): boolean {
  const scope = globalThis as unknown as MiniProgramNavigatorScope;
  const existing = scope.navigator;
  if (
    existing
    && typeof existing.platform === 'string'
    && typeof existing.userAgent === 'string'
    && typeof existing.maxTouchPoints === 'number'
  ) {
    return false;
  }

  let deviceInfo: MiniProgramDeviceInfo = {};
  try {
    deviceInfo = scope.wx?.getDeviceInfo?.() ?? scope.wx?.getSystemInfoSync?.() ?? {};
  } catch {
    deviceInfo = {};
  }

  const platform = String(deviceInfo.platform || 'miniprogram');
  const system = String(deviceInfo.system || deviceInfo.model || platform);
  const userAgent = [deviceInfo.brand, deviceInfo.model, system, 'MicroMessenger']
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ');
  const navigatorLike: MiniProgramNavigator = {
    platform,
    userAgent: userAgent || 'MicroMessenger',
    maxTouchPoints: 1,
  };
  const nextNavigator = { ...existing, ...navigatorLike };

  try {
    Object.defineProperty(scope, 'navigator', {
      value: nextNavigator,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return true;
  } catch {
    try {
      scope.navigator = nextNavigator;
      return true;
    } catch {
      return false;
    }
  }
}

function patchTextDecoderDecode(): boolean {
  const decoderConstructor = (globalThis as { TextDecoder?: TextDecoderConstructor }).TextDecoder;
  if (!decoderConstructor || typeof decoderConstructor.prototype?.decode !== 'function') {
    return false;
  }

  const prototype = decoderConstructor.prototype as TextDecoderLike & Record<string, unknown>;
  if (prototype[TEXT_DECODER_PATCH_FLAG]) {
    return false;
  }

  const originalDecode = prototype.decode;
  const guardedDecode = function decode(
    this: TextDecoderLike,
    input?: ArrayBuffer | ArrayBufferView | ArrayLike<number> | null,
    options?: TextDecoderDecodeOptions,
  ): string {
    if (input === undefined || input === null) {
      // Feed the polyfill an empty byte source instead of the `undefined` it
      // would try to read `.length` from.
      return originalDecode.call(this, new Uint8Array(0), options);
    }
    return originalDecode.call(this, input, options);
  };

  prototype.decode = guardedDecode;
  try {
    Object.defineProperty(prototype, TEXT_DECODER_PATCH_FLAG, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // A non-extensible prototype would only cost us the idempotency marker.
  }

  return true;
}
