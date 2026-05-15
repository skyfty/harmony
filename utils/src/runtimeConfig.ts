export type HarmonyRuntimeConfig = {
  http?: {
    isDev?: boolean;
    apiBaseUrl?: string;
    downloadCdnBaseUrl?: string;
    testAccount?: {
      username?: string;
      password?: string;
      displayName?: string;
    };
  };
  scenery?: {
    enableGltfDraco?: boolean;
  };
};

type HarmonyRuntimeGlobal = typeof globalThis & {
  __HARMONY_RUNTIME__?: HarmonyRuntimeConfig;
};

function getRuntimeGlobal(): HarmonyRuntimeGlobal {
  return globalThis as HarmonyRuntimeGlobal;
}

function mergeRuntimeConfig(target: HarmonyRuntimeConfig, patch: HarmonyRuntimeConfig): HarmonyRuntimeConfig {
  const http = patch.http
    ? {
        ...(target.http ?? {}),
        ...patch.http,
        testAccount: {
          ...(target.http?.testAccount ?? {}),
          ...(patch.http.testAccount ?? {}),
        },
      }
    : target.http;

  const scenery = patch.scenery
    ? {
        ...(target.scenery ?? {}),
        ...patch.scenery,
      }
    : target.scenery;

  return {
    ...target,
    ...patch,
    http,
    scenery,
  };
}

export function configureHarmonyRuntime(config: HarmonyRuntimeConfig): void {
  const runtimeGlobal = getRuntimeGlobal();
  runtimeGlobal.__HARMONY_RUNTIME__ = mergeRuntimeConfig(runtimeGlobal.__HARMONY_RUNTIME__ ?? {}, config);
}

export function getHarmonyRuntime(): HarmonyRuntimeConfig {
  return getRuntimeGlobal().__HARMONY_RUNTIME__ ?? {};
}
