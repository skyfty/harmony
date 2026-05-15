export const LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_COUNT = 128
export const LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_RADIUS = 20

export function shouldUseReceiverOnlyForDenseInstancedMesh(instanceCount: number, radius: number): boolean {
  return instanceCount >= LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_COUNT
    && Number.isFinite(radius)
    && radius > 0
    && radius <= LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_RADIUS
}
