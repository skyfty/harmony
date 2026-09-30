import * as THREE from 'three'
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createRegionBuildTool } from '@/components/editor/RegionBuildTool'
import { createRegionEditorGroup } from '@/components/editor/RegionEditorGroup'

function pointerUp(button: number, x: number, y: number, timeStamp: number): PointerEvent {
  return {
    button,
    pointerId: 1,
    clientX: x,
    clientY: y,
    timeStamp,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  } as PointerEvent
}

describe('Region visibility', () => {
  it('renders the drawing preview with a high-contrast overlay and cleans it up on cancel', () => {
    const rootGroup = new THREE.Group()
    const tool = createRegionBuildTool({
      activeBuildTool: ref('region'),
      sceneStore: {} as never,
      rootGroup,
      raycastGroundPoint: (event, result) => {
        result.set((event as PointerEvent).clientX, 0, (event as PointerEvent).clientY)
        return true
      },
      snapPoint: (point) => point,
      isAltOverrideActive: () => false,
      clickDragThresholdPx: 4,
    })

    tool.handlePointerUp(pointerUp(0, 0, 0, 10))
    tool.handlePointerUp(pointerUp(0, 4, 0, 20))
    tool.flushPreviewIfNeeded(null)

    const preview = rootGroup.children[0] as THREE.Group
    const meshes = preview.children as THREE.Mesh[]
    expect(preview.userData.isRegionPreview).toBe(true)
    expect(meshes.length).toBeGreaterThan(0)
    expect(meshes.some((mesh) => mesh.renderOrder === 140)).toBe(true)
    expect(meshes.some((mesh) => mesh.renderOrder === 141)).toBe(true)
    expect(meshes.every((mesh) => {
      const material = mesh.material as THREE.MeshBasicMaterial
      return material.depthTest === false && material.depthWrite === false
    })).toBe(true)

    expect(tool.cancel()).toBe(true)
    expect(rootGroup.children).toHaveLength(0)
    tool.dispose()
  })

  it('uses a contrasting committed outline that preserves scene depth testing', () => {
    const group = createRegionEditorGroup({
      type: 'Region',
      vertices: [[0, 0], [4, 0], [4, 3]],
    })
    const outline = group.userData.regionLine as THREE.Group
    const segments = outline.children as THREE.Mesh[]
    const halo = segments.find((segment) => segment.renderOrder === 101)
    const core = segments.find((segment) => segment.renderOrder === 102)

    expect(halo).toBeDefined()
    expect(core).toBeDefined()
    expect((halo!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x101418)
    expect((core!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffd54f)
    expect((halo!.material as THREE.MeshBasicMaterial).depthTest).toBe(true)
    expect((core!.material as THREE.MeshBasicMaterial).depthTest).toBe(true)
  })
})