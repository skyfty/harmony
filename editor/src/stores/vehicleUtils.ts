// Vehicle wheel helpers extracted from sceneStore.
// Use `import type` for shared types to avoid runtime cycles.

import type { SceneNode } from '@harmony/schema'

type InferredWheel = {
  id: string
  nodeId: string
  chassisConnectionPointLocal: { x: number; y: number; z: number }
  isFrontWheel: boolean
}

export function isVehicleWheelCandidateNode(node: SceneNode): boolean {
  const name = (node.name ?? '').trim().toLowerCase()
  if (!name) return false
  // Best-effort heuristic: common wheel/tire naming patterns (including Chinese).
  return name.includes('wheel') || name.includes('tire') || name.includes('tyre') || name.includes('轮')
}

export function collectVehicleWheelCandidates(root: SceneNode, maxDepth = 3): SceneNode[] {
  const result: SceneNode[] = []
  const visit = (node: SceneNode, depth: number) => {
    if (depth > maxDepth) return
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child) => {
      if (isVehicleWheelCandidateNode(child)) {
        result.push(child)
      }
      visit(child, depth + 1)
    })
  }
  visit(root, 1)
  return result
}

export type VehicleDeps = {
  generateUuid: () => string
}

export function inferVehicleWheelsFromNodeWithDeps(
  deps: VehicleDeps,
  chassisNode: SceneNode,
  axisIndexForward: number,
): Array<Partial<InferredWheel>> {
  const candidates = collectVehicleWheelCandidates(chassisNode)
  if (!candidates.length) {
    return []
  }

  const axisKey = axisIndexForward === 1 ? 'y' : axisIndexForward === 2 ? 'z' : 'x'
  const forwardValues = candidates
    .map((node) => {
      const raw = (node.position as any)?.[axisKey]
      const numeric = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(numeric) ? numeric : null
    })
    .filter((value): value is number => value !== null)

  const center = forwardValues.length
    ? forwardValues.reduce((sum, value) => sum + value, 0) / forwardValues.length
    : 0

  return candidates.map((node) => {
    const rawForward = (node.position as any)?.[axisKey]
    const forward = typeof rawForward === 'number' ? rawForward : Number(rawForward)
    const isFrontWheel = Number.isFinite(forward) ? forward >= center : true
    return {
      id: deps.generateUuid(),
      nodeId: node.id,
      chassisConnectionPointLocal: { x: node.position.x, y: node.position.y, z: node.position.z },
      isFrontWheel,
    }
  })
}

export default {
  isVehicleWheelCandidateNode,
  collectVehicleWheelCandidates,
  inferVehicleWheelsFromNodeWithDeps,
}
