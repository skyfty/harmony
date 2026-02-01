import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'

type BlockedBuildTool = 'wall' | 'road' | 'floor'

function isBlockedBuildTool(tool: BuildTool | null): tool is BlockedBuildTool {
  return tool === 'wall' || tool === 'road' || tool === 'floor'
}

export const useBuildToolsStore = defineStore('buildTools', () => {
  const activeBuildTool = ref<BuildTool | null>(null)
  const wallBrushPresetAssetId = ref<string | null>(null)
  const floorBrushPresetAssetId = ref<string | null>(null)
  const wallBuildShape = ref<WallBuildShape>('polygon')
  const floorBuildShape = ref<FloorBuildShape>('polygon')

  // This is a UI gate (e.g. ground sculpt config mode). It should block *activating* build tools,
  // but should not forcibly clear the active tool by itself (SceneViewport is responsible for
  // canceling live sessions).
  const buildToolsDisabled = ref(false)

  function setBuildToolsDisabled(disabled: boolean): void {
    buildToolsDisabled.value = Boolean(disabled)
  }

  function setActiveBuildTool(tool: BuildTool | null): boolean {
    if (tool && buildToolsDisabled.value && isBlockedBuildTool(tool)) {
      return false
    }
    activeBuildTool.value = tool
    return true
  }

  function setWallBrushPresetAssetId(
    assetId: string | null,
    options: { activate?: boolean } = {},
  ): boolean {
    wallBrushPresetAssetId.value = assetId
    if (options.activate) {
      return setActiveBuildTool('wall')
    }
    return true
  }

  function setFloorBrushPresetAssetId(
    assetId: string | null,
    options: { activate?: boolean } = {},
  ): boolean {
    floorBrushPresetAssetId.value = assetId
    if (options.activate) {
      return setActiveBuildTool('floor')
    }
    return true
  }

  function setFloorBuildShape(shape: FloorBuildShape, options: { activate?: boolean } = {}): boolean {
    floorBuildShape.value = shape
    if (options.activate) {
      return setActiveBuildTool('floor')
    }
    return true
  }

  function setWallBuildShape(shape: WallBuildShape, options: { activate?: boolean } = {}): boolean {
    wallBuildShape.value = shape
    if (options.activate) {
      return setActiveBuildTool('wall')
    }
    return true
  }

  return {
    activeBuildTool,
    wallBrushPresetAssetId,
    floorBrushPresetAssetId,
    wallBuildShape,
    floorBuildShape,
    buildToolsDisabled,
    setBuildToolsDisabled,
    setActiveBuildTool,
    setWallBrushPresetAssetId,
    setFloorBrushPresetAssetId,
    setFloorBuildShape,
    setWallBuildShape,
  }
})
