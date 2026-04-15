declare const AssetTypesList: readonly ["model", "image", "texture", "audio", "hdri", "material", "file", "prefab", "lod", "video", "mesh", "behavior"];
export type AssetType = (typeof AssetTypesList)[number];
export declare const AssetTypes: readonly AssetType[];
export declare const DEFAULT_ASSET_TYPE: AssetType;
export declare function isAssetType(value: unknown): value is AssetType;
export declare function normalizeAssetType(value: unknown, fallback?: AssetType): AssetType;
export {};
