export class LocalAsset {
  static ASSET_MAP: string;
  static USE_BROTLI: boolean;

  static resolve(type: 'wasm' | 'worker', path: string): string;
}
