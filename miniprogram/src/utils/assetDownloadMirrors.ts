export type AssetDownloadHostMirrorMap = Record<string, string[]>;

/**
 * Asset download host mirror mapping (优先切源).
 *
 * Key: original host (e.g. v.touchmagic.cn)
 * Value: mirror hosts or origins in preferred order.
 *   - Host form: "cdn.v.touchmagic.cn"
 *   - Origin form: "https://cdn.v.touchmagic.cn" (allows forcing protocol)
 *
 * Notes:
 * - This mapping only affects the *download URL candidates*.
 * - The asset identifier / cache key stays as the original URL / assetId.
 */
export const ASSET_DOWNLOAD_HOST_MIRRORS: AssetDownloadHostMirrorMap = {
  'v.touchmagic.cn': [
    'cdn.v.touchmagic.cn',
    // Add additional mirrors here, in priority order.
    // Example: 'cdn2.v.touchmagic.cn',
  ],
};
