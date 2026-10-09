import type * as THREE from 'three';
import type { SparkRenderer, SparkRendererOptions, SplatMesh } from '@sparkjsdev/spark';

/** 与 `sparkRuntime.ts` 保持一致：识别 wasm 初始化失败（小程序打包路径会别名到该实现）。 */
export const SPARK_WASM_INIT_FAILED_CODE = 'SPARK_WASM_INIT_FAILED';

const SPARK_WASM_FAILURE_MESSAGE_PATTERN =
  /invalid wasm file|SparkWasmInitError|SPARK_WASM_INIT_FAILED/i;

export function isSparkWasmInitFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    const message = typeof error === 'string' ? error : '';
    return SPARK_WASM_FAILURE_MESSAGE_PATTERN.test(message);
  }
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; __harmonySparkWasmInitFailed?: unknown };
  if (candidate.__harmonySparkWasmInitFailed === true) {
    return true;
  }
  if (
    candidate.code === SPARK_WASM_INIT_FAILED_CODE
    || candidate.name === 'SparkWasmInitError'
  ) {
    return true;
  }
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return SPARK_WASM_FAILURE_MESSAGE_PATTERN.test(message);
}

/** Spark 渲染器参数（不含 `renderer`），用于按终端档位收敛质量/性能。 */
export type SparkRendererTuning = Omit<SparkRendererOptions, 'renderer'>;

type SparkRuntimeModule = typeof import('@harmony/schema/sparkRuntimeMiniEntry');

let sparkRuntimePromise: Promise<SparkRuntimeModule> | null = null;
let disposeSparkObjectHook: ((object: THREE.Object3D) => void) | null = null;
let disposeSparkSceneHook: ((scene: THREE.Scene | null | undefined) => void) | null = null;
let getSparkSplatBoundsHook: ((object: THREE.Object3D) => THREE.Box3 | null) | null = null;

function loadSparkRuntime(): Promise<SparkRuntimeModule> {
  if (!sparkRuntimePromise) {
    sparkRuntimePromise = import('@harmony/schema/sparkRuntimeMiniEntry').then((module) => {
      disposeSparkObjectHook = module.disposeSparkObject;
      disposeSparkSceneHook = module.disposeSparkScene;
      getSparkSplatBoundsHook = module.getSparkSplatBounds;
      return module;
    });
  }
  return sparkRuntimePromise;
}

/**
 * Mini-program lazy-loading facade for the Spark Gaussian-splat runtime.
 *
 * `@sparkjsdev/spark` is intentionally not imported at runtime here. The heavy
 * implementation is loaded only when a RAD/splat path is actually used, so the
 * Spark library can live in a dedicated WeChat subpackage instead of the main
 * package. H5/editor builds alias this facade to the synchronous implementation.
 */
export async function createPagedRadSplat(bytes: ArrayBuffer, filename: string): Promise<SplatMesh> {
  const module = await loadSparkRuntime();
  return module.createPagedRadSplat(bytes, filename);
}

export async function createPagedRadSplatFromUrl(
  url: string,
  filename: string,
): Promise<SplatMesh | null> {
  const module = await loadSparkRuntime();
  return module.createPagedRadSplatFromUrl(url, filename);
}

export async function attachSparkRenderer(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  tuning?: SparkRendererTuning,
): Promise<SparkRenderer> {
  const module = await loadSparkRuntime();
  return module.attachSparkRenderer(scene, renderer, tuning);
}

export function disposeSparkScene(scene: THREE.Scene | null | undefined): void {
  if (disposeSparkSceneHook) {
    disposeSparkSceneHook(scene);
    return;
  }

  // Before Spark has loaded there cannot be any Spark-owned scene resources, so
  // a no-op is safe. Do not trigger the heavyweight import from a teardown path.
}

export function getSparkSplatBounds(object: THREE.Object3D): THREE.Box3 | null {
  return getSparkSplatBoundsHook ? getSparkSplatBoundsHook(object) : null;
}

export function disposeSparkObject(object: THREE.Object3D): void {
  if (disposeSparkObjectHook) {
    disposeSparkObjectHook(object);
  }
}
