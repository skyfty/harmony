import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { WaterBuildShape } from '@/types/water-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'

export const useBuildToolsStore = defineStore('buildTools', () => {
  const activeBuildTool = ref<BuildTool | null>(null)
  const wallBrushPresetAssetId = ref<string | null>(null)
  const floorBrushPresetAssetId = ref<string | null>(null)
  const wallBuildShape = ref<WallBuildShape>('line')
  const wallRegularPolygonSides = ref(0)
  const wallDoorSelectModeActive = ref(false)
  const floorBuildShape = ref<FloorBuildShape>('polygon')
  const floorRegularPolygonSides = ref(0)
  const waterBuildShape = ref<WaterBuildShape>('rectangle')

  // This is a UI gate (e.g. ground sculpt config mode). It should block *activating* build tools,
  // but should not forcibly clear the active tool by itself (SceneViewport is responsible for
  // canceling live sessions).
  const buildToolsDisabled = ref(false)

  function setBuildToolsDisabled(disabled: boolean): void {
    buildToolsDisabled.value = Boolean(disabled)
  }

  function setActiveBuildTool(tool: BuildTool | null): boolean {
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

  function setFloorRegularPolygonSides(sides: number): void {
    if (!Number.isFinite(sides)) {
      floorRegularPolygonSides.value = 0
      return
    }
    const rounded = Math.round(sides)
    const clamped = Math.min(256, Math.max(0, rounded))
    floorRegularPolygonSides.value = clamped >= 3 ? clamped : 0
  }

  function setWallBuildShape(shape: WallBuildShape, options: { activate?: boolean } = {}): boolean {
    wallBuildShape.value = shape
    if (options.activate) {
      return setActiveBuildTool('wall')
    }
    return true
  }

  function setWallRegularPolygonSides(sides: number): void {
    if (!Number.isFinite(sides)) {
      wallRegularPolygonSides.value = 0
      return
    }
    const rounded = Math.round(sides)
    const clamped = Math.min(256, Math.max(0, rounded))
    wallRegularPolygonSides.value = clamped >= 3 ? clamped : 0
  }

  function setWallDoorSelectModeActive(active: boolean): void {
    wallDoorSelectModeActive.value = Boolean(active)
  }

  function setWaterBuildShape(shape: WaterBuildShape, options: { activate?: boolean } = {}): boolean {
    waterBuildShape.value = shape
    if (options.activate) {
      return setActiveBuildTool('water')
    }
    return true
  }

  return {
    activeBuildTool,
    wallBrushPresetAssetId,
    floorBrushPresetAssetId,
    wallBuildShape,
    wallRegularPolygonSides,
    wallDoorSelectModeActive,
    floorBuildShape,
    floorRegularPolygonSides,
    waterBuildShape,
    buildToolsDisabled,
    setBuildToolsDisabled,
    setActiveBuildTool,
    setWallBrushPresetAssetId,
    setFloorBrushPresetAssetId,
    setFloorBuildShape,
    setFloorRegularPolygonSides,
    setWallBuildShape,
    setWallRegularPolygonSides,
    setWallDoorSelectModeActive,
    setWaterBuildShape,
  }
})
