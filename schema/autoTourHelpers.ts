import * as THREE from 'three'

export interface AutoTourRuntimeLike {
  startTour(nodeId: string): void
  stopTour(nodeId: string): void
}

type AutoTourVehicleInstanceLike = {
  vehicle?: {
    chassisBody?: {
      position?: {
        x: number
        y: number
        z: number
      } | null
    } | null
  } | null
}

export function createPhysicsAwareAutoTourVehicleInstances<T>(
  vehicleInstances: Map<string, T>,
  isPhysicsEnabled: () => boolean,
): Map<string, T> {
  return new Proxy(vehicleInstances, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (nodeId: string) => {
          if (!isPhysicsEnabled()) {
            return undefined
          }
          return target.get(nodeId)
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as Map<string, T>
}

export function resolveAutoTourReferenceWorldPosition<T extends AutoTourVehicleInstanceLike>(options: {
  nodeId: string | null | undefined
  vehicleInstances: Map<string, T>
  nodeObjectMap: Map<string, THREE.Object3D>
  isPhysicsEnabled: () => boolean
  target: THREE.Vector3
}): boolean {
  return resolveVehicleOrObjectWorldPosition(options)
}

export function resolveVehicleOrObjectWorldPosition<T extends AutoTourVehicleInstanceLike>(options: {
  nodeId: string | null | undefined
  vehicleInstances: Map<string, T>
  nodeObjectMap: Map<string, THREE.Object3D>
  isPhysicsEnabled: () => boolean
  target: THREE.Vector3
}): boolean {
  const { nodeId, vehicleInstances, nodeObjectMap, isPhysicsEnabled, target } = options
  if (!nodeId) {
    return false
  }
  if (isPhysicsEnabled()) {
    const bodyPosition = vehicleInstances.get(nodeId)?.vehicle?.chassisBody?.position ?? null
    if (bodyPosition) {
      target.set(bodyPosition.x, bodyPosition.y, bodyPosition.z)
      return true
    }
  }
  const followObject = nodeObjectMap.get(nodeId) ?? null
  if (!followObject) {
    return false
  }
  followObject.getWorldPosition(target)
  return true
}

/**
 * Start an auto-tour and invoke `onFollow` so callers can set up follow state.
 */
export function startTourAndFollow(
  runtime: AutoTourRuntimeLike,
  nodeId: string,
  onFollow?: (nodeId: string) => void,
): void {
  try {
    runtime.startTour(nodeId)
  } catch {
    // ignore runtime errors here; callers may still want to attempt follow-side effects
  }
  try {
    onFollow?.(nodeId)
  } catch {
    // swallow
  }
}

/**
 * Stop an auto-tour and invoke `onUnfollow` so callers can tear down follow state.
 */
export function stopTourAndUnfollow(
  runtime: AutoTourRuntimeLike,
  nodeId: string,
  onUnfollow?: (nodeId: string) => void,
): void {
  try {
    runtime.stopTour(nodeId)
  } catch {
    // ignore
  }
  try {
    onUnfollow?.(nodeId)
  } catch {
    // ignore
  }
}
