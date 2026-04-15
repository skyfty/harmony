const AssetTypesList = [
    'model',
    'image',
    'texture',
    'audio',
    'hdri',
    'material',
    'file',
    'prefab',
    'lod',
    'video',
    'mesh',
    'behavior',
];
export const AssetTypes = AssetTypesList;
export const DEFAULT_ASSET_TYPE = 'file';
export function isAssetType(value) {
    return typeof value === 'string' && AssetTypes.includes(value);
}
export function normalizeAssetType(value, fallback = DEFAULT_ASSET_TYPE) {
    if (typeof value !== 'string') {
        return fallback;
    }
    if (isAssetType(value)) {
        return value;
    }
    return fallback;
}
