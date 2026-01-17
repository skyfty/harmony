import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { SceneNode } from '@harmony/schema'
import { getModelInstanceBindingsForNode } from '@schema/modelObjectCache'

type InstancedBoundsPayload = { min: [number, number, number]; max: [number, number, number] }

function isInstancedBoundsPayload(value: unknown): value is InstancedBoundsPayload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const payload = value as Partial<InstancedBoundsPayload>
  return Array.isArray(payload.min) && payload.min.length === 3 && Array.isArray(payload.max) && payload.max.length === 3
}

function extractInstancedBounds(node: SceneNode, object: THREE.Object3D): InstancedBoundsPayload | null {
  const nodeUserData = node.userData as Record<string, unknown> | undefined
  const nodeBoundsCandidate = nodeUserData?.instancedBounds
  if (isInstancedBoundsPayload(nodeBoundsCandidate)) {
    return nodeBoundsCandidate
  }
  const objectBoundsCandidate = object.userData?.instancedBounds
  if (isInstancedBoundsPayload(objectBoundsCandidate)) {
    return objectBoundsCandidate
  }
  return null
}

export type PickProxyManager = {
  ensureInstancedPickProxy: (object: THREE.Object3D, node: SceneNode) => void
  removeInstancedPickProxy: (object: THREE.Object3D) => void
}

export function createPickProxyManager(): PickProxyManager {
  const instancedPickProxyGeometry = new THREE.BoxGeometry(1, 1, 1)
  const instancedPickProxyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  })
  instancedPickProxyMaterial.colorWrite = false
  instancedPickProxyMaterial.toneMapped = false

  const instancedPickBoundsMinHelper = new THREE.Vector3()
  const instancedPickBoundsMaxHelper = new THREE.Vector3()
  const instancedPickBoundsSizeHelper = new THREE.Vector3()
  const instancedPickBoundsCenterHelper = new THREE.Vector3()

  const instancedPickProxyWorldInverseHelper = new THREE.Matrix4()
  const instancedPickProxyInstanceMatrixHelper = new THREE.Matrix4()
  const instancedPickProxyWorldMatrixHelper = new THREE.Matrix4()
  const instancedPickProxyLocalMatrixHelper = new THREE.Matrix4()
  const instancedPickProxyAssetBoxMatrixHelper = new THREE.Matrix4()
  const instancedPickProxyIdentityQuaternionHelper = new THREE.Quaternion()
  const instancedPickProxyAssetBoundsHelper = new THREE.Box3()
  const instancedPickProxyPointsBoundsHelper = new THREE.Box3()
  const instancedPickProxyCornerHelpers = Array.from({ length: 8 }, () => new THREE.Vector3())
  const instancedPickProxySamplePointsCache = new Map<string, THREE.Vector3[]>()
  const instancedPickProxyPointHelper = new THREE.Vector3()
  const instancedPickProxyMeanHelper = new THREE.Vector3()

  function removeInstancedPickProxy(object: THREE.Object3D) {
    const proxy = object.userData?.instancedPickProxy as THREE.Object3D | undefined
    if (!proxy) {
      return
    }
    proxy.removeFromParent()
    delete object.userData.instancedPickProxy
  }

  function ensureInstancedPickProxy(object: THREE.Object3D, node: SceneNode) {
    const isWall = node.dynamicMesh?.type === 'Wall'

    const ensureProxyObject = (): THREE.Mesh | THREE.InstancedMesh => {
      const existing = object.userData?.instancedPickProxy as THREE.Object3D | undefined
      const shouldBeInstanced = isWall
      const isExistingInstanced = Boolean((existing as THREE.InstancedMesh | undefined)?.isInstancedMesh)

      if (existing && isExistingInstanced === shouldBeInstanced) {
        existing.userData = existing.userData ?? {}
        existing.userData.nodeId = node.id
        return existing as THREE.Mesh | THREE.InstancedMesh
      }

      if (existing) {
        existing.removeFromParent()
      }

      const created = shouldBeInstanced
        ? new THREE.InstancedMesh(instancedPickProxyGeometry, instancedPickProxyMaterial, 1)
        : new THREE.Mesh(instancedPickProxyGeometry, instancedPickProxyMaterial)

      created.name = `${object.name ?? node.name ?? 'Instanced'}:PickProxy`
      created.userData = {
        ...(created.userData ?? {}),
        nodeId: node.id,
        instancedPickProxy: true,
        excludeFromOutline: true,
      }
      created.renderOrder = -9999
      created.frustumCulled = false
      object.add(created)

      const userData = object.userData ?? (object.userData = {})
      userData.instancedPickProxy = created
      return created
    }

    const proxy = ensureProxyObject()

    // Build a pick volume that covers *all* instanced bindings of this node.
    // This makes clicking/dragging any instance select & transform around the correct center.
    const bindings = getModelInstanceBindingsForNode(node.id)

    const restoreProxyToUnitBox = (center: THREE.Vector3, size: THREE.Vector3) => {
      const eps = 1e-4
      const safeSize = instancedPickBoundsSizeHelper.set(
        Math.max(size.x, eps),
        Math.max(size.y, eps),
        Math.max(size.z, eps),
      )

      // Persist for pivot calculations (SceneViewport reads this, regardless of proxy type).
      proxy.userData = proxy.userData ?? {}
      proxy.userData.instancedPickProxyBounds = {
        min: [center.x - safeSize.x * 0.5, center.y - safeSize.y * 0.5, center.z - safeSize.z * 0.5],
        max: [center.x + safeSize.x * 0.5, center.y + safeSize.y * 0.5, center.z + safeSize.z * 0.5],
      } satisfies InstancedBoundsPayload

      if ((proxy as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = proxy as THREE.InstancedMesh
        instanced.position.set(0, 0, 0)
        instanced.scale.set(1, 1, 1)
        instancedPickProxyAssetBoxMatrixHelper.compose(center, instancedPickProxyIdentityQuaternionHelper, safeSize)
        instanced.setMatrixAt(0, instancedPickProxyAssetBoxMatrixHelper)
        ;(instanced as unknown as { count?: number }).count = 1
        instanced.instanceMatrix.needsUpdate = true
        instanced.visible = true
        instanced.updateMatrixWorld(true)
        return
      }

      const mesh = proxy as THREE.Mesh
      if (mesh.geometry !== instancedPickProxyGeometry) {
        mesh.geometry.dispose()
        mesh.geometry = instancedPickProxyGeometry
      }
      mesh.position.copy(center)
      mesh.scale.copy(safeSize)
      mesh.visible = true
      mesh.updateMatrixWorld(true)
    }

    // If we can't see any bindings, fall back to serialized bounds if available.
    if (!bindings.length) {
      const fallback = extractInstancedBounds(node, object)
      if (!fallback) {
        removeInstancedPickProxy(object)
        return
      }
      instancedPickBoundsMinHelper.fromArray(fallback.min)
      instancedPickBoundsMaxHelper.fromArray(fallback.max)
      instancedPickBoundsSizeHelper.subVectors(instancedPickBoundsMaxHelper, instancedPickBoundsMinHelper)
      instancedPickBoundsCenterHelper
        .addVectors(instancedPickBoundsMinHelper, instancedPickBoundsMaxHelper)
        .multiplyScalar(0.5)
      restoreProxyToUnitBox(instancedPickBoundsCenterHelper, instancedPickBoundsSizeHelper)
      return
    }

    // Determine the asset-local bounds (single instance) from the binding's submesh geometries.
    instancedPickProxyAssetBoundsHelper.makeEmpty()
    const firstBinding = bindings[0]
    if (firstBinding) {
      firstBinding.slots.forEach(({ mesh }) => {
        const geometry = mesh.geometry as THREE.BufferGeometry
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox()
        }
        if (geometry.boundingBox) {
          instancedPickProxyAssetBoundsHelper.union(geometry.boundingBox)
        }
      })
    }

    if (instancedPickProxyAssetBoundsHelper.isEmpty()) {
      const bounds = extractInstancedBounds(node, object)
      if (bounds) {
        instancedPickProxyAssetBoundsHelper.min.fromArray(bounds.min)
        instancedPickProxyAssetBoundsHelper.max.fromArray(bounds.max)
      }
    }

    if (instancedPickProxyAssetBoundsHelper.isEmpty()) {
      removeInstancedPickProxy(object)
      return
    }

    // Walls can be concave (polyline with corners). A convex hull proxy incorrectly covers the inner corner area.
    // For wall nodes, build an InstancedMesh proxy: one oriented box per binding instance.
    if (isWall && (proxy as THREE.InstancedMesh).isInstancedMesh) {
      object.updateMatrixWorld(true)
      instancedPickProxyWorldInverseHelper.copy(object.matrixWorld).invert()

      // Asset-local box transform (unit box -> asset bounds).
      instancedPickProxyAssetBoundsHelper.getCenter(instancedPickBoundsCenterHelper)
      instancedPickProxyAssetBoundsHelper.getSize(instancedPickBoundsSizeHelper)
      const eps = 1e-4
      instancedPickBoundsSizeHelper.set(
        Math.max(instancedPickBoundsSizeHelper.x, eps),
        Math.max(instancedPickBoundsSizeHelper.y, eps),
        Math.max(instancedPickBoundsSizeHelper.z, eps),
      )
      instancedPickProxyAssetBoxMatrixHelper.compose(
        instancedPickBoundsCenterHelper,
        instancedPickProxyIdentityQuaternionHelper,
        instancedPickBoundsSizeHelper,
      )

      const instanced = proxy as THREE.InstancedMesh
      const MAX_PROXY_INSTANCES = 2048
      const bindingStep = Math.max(1, Math.ceil(bindings.length / MAX_PROXY_INSTANCES))
      const instanceCount = Math.min(MAX_PROXY_INSTANCES, Math.ceil(bindings.length / bindingStep))
      ;(instanced as unknown as { count?: number }).count = instanceCount

      // Aggregate bounds in object-local space for pivot calculations.
      instancedPickProxyPointsBoundsHelper.makeEmpty()

      let instanceWriteIndex = 0
      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += bindingStep) {
        const binding = bindings[bindingIndex]
        if (!binding) {
          continue
        }
        const slot = binding.slots[0]
        if (!slot) {
          continue
        }

        const mesh = slot.mesh
        mesh.updateMatrixWorld(true)
        mesh.getMatrixAt(slot.index, instancedPickProxyInstanceMatrixHelper)
        instancedPickProxyWorldMatrixHelper.multiplyMatrices(mesh.matrixWorld, instancedPickProxyInstanceMatrixHelper)
        instancedPickProxyLocalMatrixHelper.multiplyMatrices(
          instancedPickProxyWorldInverseHelper,
          instancedPickProxyWorldMatrixHelper,
        )

        // Instance matrix = (assetLocal -> objectLocal) * (unitBox -> assetBounds)
        instancedPickProxyInstanceMatrixHelper.multiplyMatrices(
          instancedPickProxyLocalMatrixHelper,
          instancedPickProxyAssetBoxMatrixHelper,
        )
        instanced.setMatrixAt(instanceWriteIndex, instancedPickProxyInstanceMatrixHelper)

        // Expand aggregate bounds using the transformed asset bounds corners.
        for (let i = 0; i < 8; i += 1) {
          const corner = instancedPickProxyCornerHelpers[i]
          if (!corner) {
            continue
          }
          instancedPickProxyPointsBoundsHelper.expandByPoint(
            instancedPickProxyPointHelper.copy(corner).applyMatrix4(instancedPickProxyLocalMatrixHelper),
          )
        }

        instanceWriteIndex += 1
        if (instanceWriteIndex >= instanceCount) {
          break
        }
      }

      instanced.instanceMatrix.needsUpdate = true
      instanced.position.set(0, 0, 0)
      instanced.scale.set(1, 1, 1)
      instanced.visible = true
      instanced.updateMatrixWorld(true)

      if (instancedPickProxyPointsBoundsHelper.isEmpty()) {
        removeInstancedPickProxy(object)
        return
      }

      // Persist bounds for pivot use.
      proxy.userData = proxy.userData ?? {}
      proxy.userData.instancedPickProxyBounds = {
        min: [
          instancedPickProxyPointsBoundsHelper.min.x,
          instancedPickProxyPointsBoundsHelper.min.y,
          instancedPickProxyPointsBoundsHelper.min.z,
        ],
        max: [
          instancedPickProxyPointsBoundsHelper.max.x,
          instancedPickProxyPointsBoundsHelper.max.y,
          instancedPickProxyPointsBoundsHelper.max.z,
        ],
      } satisfies InstancedBoundsPayload

      return
    }

    // Precompute the 8 corners of the asset bounds.
    const min = instancedPickProxyAssetBoundsHelper.min
    const max = instancedPickProxyAssetBoundsHelper.max
    instancedPickProxyCornerHelpers[0]!.set(min.x, min.y, min.z)
    instancedPickProxyCornerHelpers[1]!.set(max.x, min.y, min.z)
    instancedPickProxyCornerHelpers[2]!.set(min.x, max.y, min.z)
    instancedPickProxyCornerHelpers[3]!.set(max.x, max.y, min.z)
    instancedPickProxyCornerHelpers[4]!.set(min.x, min.y, max.z)
    instancedPickProxyCornerHelpers[5]!.set(max.x, min.y, max.z)
    instancedPickProxyCornerHelpers[6]!.set(min.x, max.y, max.z)
    instancedPickProxyCornerHelpers[7]!.set(max.x, max.y, max.z)

    const getAssetSamplePoints = (): THREE.Vector3[] => {
      if (!firstBinding) {
        return []
      }
      const geometryIds = firstBinding.slots
        .map((slot) => (slot.mesh.geometry as THREE.BufferGeometry | undefined)?.uuid)
        .filter((id): id is string => Boolean(id))
      const cacheKey = geometryIds.join('|')
      const cached = instancedPickProxySamplePointsCache.get(cacheKey)
      if (cached) {
        return cached
      }

      const points: THREE.Vector3[] = []
      const MAX_POINTS_PER_ASSET = 160
      const slotCount = firstBinding.slots.length
      const maxPerSlot = Math.max(8, Math.floor(MAX_POINTS_PER_ASSET / Math.max(1, slotCount)))

      firstBinding.slots.forEach(({ mesh }) => {
        const geometry = mesh.geometry as THREE.BufferGeometry
        const position = geometry.attributes?.position as THREE.BufferAttribute | undefined
        if (position && position.count > 0) {
          const step = Math.max(1, Math.ceil(position.count / Math.max(1, maxPerSlot)))
          for (let i = 0; i < position.count; i += step) {
            points.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)))
            if (points.length >= MAX_POINTS_PER_ASSET) {
              break
            }
          }
          return
        }

        // Fallback to bounding box corners when vertex data is not available.
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox()
        }
        const bb = geometry.boundingBox
        if (!bb) {
          return
        }
        const gmin = bb.min
        const gmax = bb.max
        points.push(
          new THREE.Vector3(gmin.x, gmin.y, gmin.z),
          new THREE.Vector3(gmax.x, gmin.y, gmin.z),
          new THREE.Vector3(gmin.x, gmax.y, gmin.z),
          new THREE.Vector3(gmax.x, gmax.y, gmin.z),
          new THREE.Vector3(gmin.x, gmin.y, gmax.z),
          new THREE.Vector3(gmax.x, gmin.y, gmax.z),
          new THREE.Vector3(gmin.x, gmax.y, gmax.z),
          new THREE.Vector3(gmax.x, gmax.y, gmax.z),
        )
      })

      // If nothing was collected, fall back to the asset bounds corners.
      if (points.length === 0) {
        for (let i = 0; i < 8; i += 1) {
          const corner = instancedPickProxyCornerHelpers[i]
          if (corner) {
            points.push(corner.clone())
          }
        }
      }

      instancedPickProxySamplePointsCache.set(cacheKey, points)
      return points
    }

    const isApproximatelyCollinearXZ = (points: THREE.Vector3[]): boolean => {
      if (points.length < 3) {
        return true
      }

      let meanX = 0
      let meanZ = 0
      for (const p of points) {
        meanX += p.x
        meanZ += p.z
      }
      meanX /= points.length
      meanZ /= points.length

      let sxx = 0
      let sxz = 0
      let szz = 0
      for (const p of points) {
        const dx = p.x - meanX
        const dz = p.z - meanZ
        sxx += dx * dx
        sxz += dx * dz
        szz += dz * dz
      }

      const tr = sxx + szz
      if (tr <= 1e-8) {
        return true
      }
      const disc = Math.sqrt(Math.max(0, (sxx - szz) * (sxx - szz) + 4 * sxz * sxz))
      const lambda1 = 0.5 * (tr + disc)
      const lambda2 = 0.5 * (tr - disc)
      if (lambda1 <= 1e-8) {
        return true
      }
      const ratio = lambda2 / lambda1
      return ratio < 0.02
    }

    object.updateMatrixWorld(true)
    instancedPickProxyWorldInverseHelper.copy(object.matrixWorld).invert()

    const points: THREE.Vector3[] = []
    const MAX_PICK_POINTS = 4096
    const MAX_BINDINGS_SAMPLED = 256
    const bindingStep = Math.max(1, Math.ceil(bindings.length / MAX_BINDINGS_SAMPLED))
    const assetSamplePoints = getAssetSamplePoints()

    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += bindingStep) {
      const binding = bindings[bindingIndex]
      if (!binding) {
        continue
      }
      const slot = binding.slots[0]
      if (!slot) {
        continue
      }
      const mesh = slot.mesh
      mesh.updateMatrixWorld(true)

      mesh.getMatrixAt(slot.index, instancedPickProxyInstanceMatrixHelper)
      instancedPickProxyWorldMatrixHelper.multiplyMatrices(mesh.matrixWorld, instancedPickProxyInstanceMatrixHelper)
      instancedPickProxyLocalMatrixHelper.multiplyMatrices(
        instancedPickProxyWorldInverseHelper,
        instancedPickProxyWorldMatrixHelper,
      )

      for (let i = 0; i < assetSamplePoints.length; i += 1) {
        const sample = assetSamplePoints[i]
        if (!sample) {
          continue
        }
        points.push(instancedPickProxyPointHelper.copy(sample).applyMatrix4(instancedPickProxyLocalMatrixHelper).clone())
        if (points.length >= MAX_PICK_POINTS) {
          break
        }
      }
      if (points.length >= MAX_PICK_POINTS) {
        break
      }
    }

    if (points.length < 4) {
      instancedPickProxyPointsBoundsHelper.makeEmpty().setFromPoints(points)
      if (instancedPickProxyPointsBoundsHelper.isEmpty()) {
        removeInstancedPickProxy(object)
        return
      }
      instancedPickProxyPointsBoundsHelper.getCenter(instancedPickBoundsCenterHelper)
      instancedPickProxyPointsBoundsHelper.getSize(instancedPickBoundsSizeHelper)
      restoreProxyToUnitBox(instancedPickBoundsCenterHelper, instancedPickBoundsSizeHelper)
      return
    }

    // Prefer a fast bounds proxy when sampling hit the cap or when there are only a couple instances.
    const preferBox = points.length >= MAX_PICK_POINTS || bindings.length <= 2

    try {
      if (preferBox || isApproximatelyCollinearXZ(points)) {
        instancedPickProxyPointsBoundsHelper.makeEmpty().setFromPoints(points)
        if (instancedPickProxyPointsBoundsHelper.isEmpty()) {
          removeInstancedPickProxy(object)
          return
        }
        instancedPickProxyPointsBoundsHelper.getCenter(instancedPickBoundsCenterHelper)
        instancedPickProxyPointsBoundsHelper.getSize(instancedPickBoundsSizeHelper)
        restoreProxyToUnitBox(instancedPickBoundsCenterHelper, instancedPickBoundsSizeHelper)
        return
      }

      const MAX_HULL_POINTS = 768
      const hullPoints: THREE.Vector3[] = []
      const hullStep = Math.max(1, Math.ceil(points.length / MAX_HULL_POINTS))
      for (let i = 0; i < points.length; i += hullStep) {
        hullPoints.push(points[i]!)
      }

      // ConvexGeometry requires a 3D point set; when everything is near-planar,
      // inject a tiny thickness around the mean point to prevent hull failures.
      instancedPickProxyPointsBoundsHelper.makeEmpty().setFromPoints(hullPoints)
      const minY = instancedPickProxyPointsBoundsHelper.min.y
      const maxY = instancedPickProxyPointsBoundsHelper.max.y
      if (Math.abs(maxY - minY) < 1e-4) {
        instancedPickProxyPointsBoundsHelper.getCenter(instancedPickProxyMeanHelper)
        const eps = 1e-3
        hullPoints.push(instancedPickProxyMeanHelper.clone().add(new THREE.Vector3(0, eps, 0)))
        hullPoints.push(instancedPickProxyMeanHelper.clone().add(new THREE.Vector3(0, -eps, 0)))
      }

      const geometry = new ConvexGeometry(hullPoints)
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()

      const mesh = proxy as THREE.Mesh
      if (mesh.geometry !== instancedPickProxyGeometry) {
        mesh.geometry.dispose()
      }
      mesh.geometry = geometry
      mesh.position.set(0, 0, 0)
      mesh.scale.set(1, 1, 1)
      mesh.visible = true
      mesh.updateMatrixWorld(true)
    } catch {
      instancedPickProxyPointsBoundsHelper.makeEmpty().setFromPoints(points)
      if (instancedPickProxyPointsBoundsHelper.isEmpty()) {
        removeInstancedPickProxy(object)
        return
      }
      instancedPickProxyPointsBoundsHelper.getCenter(instancedPickBoundsCenterHelper)
      instancedPickProxyPointsBoundsHelper.getSize(instancedPickBoundsSizeHelper)
      restoreProxyToUnitBox(instancedPickBoundsCenterHelper, instancedPickBoundsSizeHelper)
    }
  }

  return {
    ensureInstancedPickProxy,
    removeInstancedPickProxy,
  }
}
