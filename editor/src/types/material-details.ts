export type MaterialDetailsTarget =
  | {
      kind: 'nodeMaterial'
      nodeId: string
      materialId: string
    }
  | {
      kind: 'houseRigPart'
      nodeId: string
      componentId: string
      partKey: string
    }

export function materialDetailsTargetKey(target: MaterialDetailsTarget | null | undefined): string {
  if (!target) {
    return ''
  }
  return target.kind === 'nodeMaterial'
    ? `node:${target.nodeId}:${target.materialId}`
    : `houseRig:${target.nodeId}:${target.componentId}:${target.partKey}`
}
