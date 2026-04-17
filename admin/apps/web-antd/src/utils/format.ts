const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatFileSize(value: number | null | undefined): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return '-';
  }
  if (size === 0) {
    return '0 B';
  }

  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), SIZE_UNITS.length - 1);
  const normalizedSize = size / 1024 ** unitIndex;
  const displaySize = normalizedSize >= 10 || unitIndex === 0 ? normalizedSize.toFixed(0) : normalizedSize.toFixed(1);
  return `${displaySize} ${SIZE_UNITS[unitIndex]}`;
}

export function formatAssetRole(value: 'dependant' | 'master' | null | undefined): string {
  switch (value) {
    case 'master':
      return '主资源';
    case 'dependant':
      return '依赖资源';
    default:
      return '-';
  }
}