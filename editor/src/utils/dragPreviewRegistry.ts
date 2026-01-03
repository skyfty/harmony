const readyAssetIds = new Set<string>()

export function setDragPreviewReady(assetId: string, ready: boolean): void {
  if (!assetId) {
    return
  }
  if (ready) {
    readyAssetIds.add(assetId)
  } else {
    readyAssetIds.delete(assetId)
  }
}

export function isDragPreviewReady(assetId: string): boolean {
  if (!assetId) {
    return false
  }
  return readyAssetIds.has(assetId)
}
