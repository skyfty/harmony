import type { SceneAssetOverrideEntry, SceneAssetRegistryEntry } from './index';

type AssetRegistryLikeEntry = SceneAssetRegistryEntry | SceneAssetOverrideEntry | null | undefined;
type AssetRegistryLikeMap = Record<string, AssetRegistryLikeEntry> | null | undefined;

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.length > 0 ? raw : null;
}

function parsePackageOriginalAssetId(zipPath: string | null | undefined): string | null {
  const normalizedZipPath = normalizeOptionalAssetId(zipPath);
  if (!normalizedZipPath) {
    return null;
  }
  const separator = normalizedZipPath.indexOf('::');
  if (separator <= 0 || separator >= normalizedZipPath.length - 2) {
    return null;
  }
  return normalizeOptionalAssetId(normalizedZipPath.slice(separator + 2));
}

function collectEntryAliasIds(entry: AssetRegistryLikeEntry): string[] {
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  const ids = new Set<string>();
  if (entry.sourceType === 'server') {
    const serverAssetId = normalizeOptionalAssetId(entry.serverAssetId);
    if (serverAssetId) {
      ids.add(serverAssetId);
    }
  }
  if (entry.sourceType === 'package') {
    const originalPackageAssetId = parsePackageOriginalAssetId(entry.zipPath);
    if (originalPackageAssetId) {
      ids.add(originalPackageAssetId);
    }
  }
  return Array.from(ids);
}

export function getAssetRegistryCanonicalId(
  assetId: string | null | undefined,
  ...maps: AssetRegistryLikeMap[]
): string | null {
  const normalizedAssetId = normalizeOptionalAssetId(assetId);
  if (!normalizedAssetId) {
    return null;
  }

  for (const map of maps) {
    if (!map || typeof map !== 'object') {
      continue;
    }
    if (map[normalizedAssetId]) {
      return normalizedAssetId;
    }
    for (const [registryKey, entry] of Object.entries(map)) {
      const normalizedRegistryKey = normalizeOptionalAssetId(registryKey);
      if (!normalizedRegistryKey) {
        continue;
      }
      if (normalizedRegistryKey === normalizedAssetId) {
        return normalizedRegistryKey;
      }
      const aliases = collectEntryAliasIds(entry);
      if (aliases.includes(normalizedAssetId)) {
        return normalizedRegistryKey;
      }
    }
  }

  return normalizedAssetId;
}

export function collectAssetRegistryLookupIds(
  assetId: string | null | undefined,
  ...maps: AssetRegistryLikeMap[]
): string[] {
  const normalizedAssetId = normalizeOptionalAssetId(assetId);
  if (!normalizedAssetId) {
    return [];
  }

  const ids = new Set<string>([normalizedAssetId]);
  const canonicalAssetId = getAssetRegistryCanonicalId(normalizedAssetId, ...maps);
  if (canonicalAssetId) {
    ids.add(canonicalAssetId);
  }

  for (const map of maps) {
    if (!map || typeof map !== 'object') {
      continue;
    }
    const entry = canonicalAssetId ? map[canonicalAssetId] : null;
    if (entry) {
      collectEntryAliasIds(entry).forEach((candidateId) => ids.add(candidateId));
    }
  }

  return Array.from(ids);
}

export function collectAssetRegistryEntryIds(
  registryKey: string,
  entry: AssetRegistryLikeEntry,
): string[] {
  const normalizedRegistryKey = normalizeOptionalAssetId(registryKey);
  if (!normalizedRegistryKey) {
    return [];
  }
  return Array.from(new Set([normalizedRegistryKey, ...collectEntryAliasIds(entry)]));
}