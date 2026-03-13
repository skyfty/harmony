import * as THREE from 'three'
import { WALL_DEFAULT_HEIGHT, WALL_DEFAULT_WIDTH } from '@schema/components'
import type { SelectedWallEraseTarget } from './wallEraseController'

type InstancedOutlineSync = {
  syncProxyMatrixFromSlot: (proxy: THREE.Object3D, mesh: THREE.InstancedMesh, index: number) => void
}

type CreateWallEraseHoverPresenterOptions = {
  instancedHoverMaterial: THREE.MeshBasicMaterial
  instancedHoverRestoreMaterial: THREE.MeshBasicMaterial
  instancedOutlineSync: InstancedOutlineSync
}

export function createWallEraseHoverPresenter(options: CreateWallEraseHoverPresenterOptions) {
  const wallEraseHoverEdgeMaterial = new THREE.LineBasicMaterial({
    color: 0x4dd0e1,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  })
  wallEraseHoverEdgeMaterial.toneMapped = false

  const wallEraseHoverBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
  const wallEraseHoverEdgesGeometry = new THREE.EdgesGeometry(wallEraseHoverBoxGeometry)

  const wallEraseHoverGroup = new THREE.Group()
  wallEraseHoverGroup.name = 'WallEraseHover'
  wallEraseHoverGroup.renderOrder = 19996
  wallEraseHoverGroup.visible = false
  wallEraseHoverGroup.frustumCulled = false

  const wallEraseHoverFill = new THREE.Mesh(wallEraseHoverBoxGeometry, options.instancedHoverMaterial)
  wallEraseHoverFill.name = 'WallEraseHoverFill'
  wallEraseHoverFill.renderOrder = 19996
  wallEraseHoverFill.frustumCulled = false
  ;(wallEraseHoverFill as any).raycast = () => {}

  const wallEraseHoverEdges = new THREE.LineSegments(wallEraseHoverEdgesGeometry, wallEraseHoverEdgeMaterial)
  wallEraseHoverEdges.name = 'WallEraseHoverEdges'
  wallEraseHoverEdges.renderOrder = 19997
  wallEraseHoverEdges.frustumCulled = false
  ;(wallEraseHoverEdges as any).raycast = () => {}

  const wallEraseRepeatHoverFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x4dd0e1,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
    depthWrite: false,
  })
  wallEraseRepeatHoverFillMaterial.toneMapped = false

  const wallEraseRepeatHoverWireMaterial = new THREE.MeshBasicMaterial({
    color: 0x4dd0e1,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  })
  wallEraseRepeatHoverWireMaterial.toneMapped = false

  const wallEraseRepeatHoverGroup = new THREE.Group()
  wallEraseRepeatHoverGroup.name = 'WallEraseRepeatHover'
  wallEraseRepeatHoverGroup.renderOrder = 19996
  wallEraseRepeatHoverGroup.visible = false
  wallEraseRepeatHoverGroup.frustumCulled = false

  wallEraseHoverGroup.add(wallEraseHoverFill)
  wallEraseHoverGroup.add(wallEraseHoverEdges)

  const wallEraseHoverDirHelper = new THREE.Vector3()
  const wallEraseHoverMidHelper = new THREE.Vector3()
  const wallEraseHoverUpHelper = new THREE.Vector3()
  const wallEraseHoverBasisXHelper = new THREE.Vector3()
  const wallEraseHoverBasisYHelper = new THREE.Vector3()
  const wallEraseHoverBasisZHelper = new THREE.Vector3()
  const wallEraseHoverMatHelper = new THREE.Matrix4()

  function clearWallEraseHoverHighlight() {
    wallEraseHoverGroup.visible = false
    while (wallEraseRepeatHoverGroup.children.length > 0) {
      const child = wallEraseRepeatHoverGroup.children[wallEraseRepeatHoverGroup.children.length - 1]
      if (!child) {
        break
      }
      child.removeFromParent()
    }
    wallEraseRepeatHoverGroup.visible = false
  }

  function updateWallEraseHoverHighlight(target: SelectedWallEraseTarget): boolean {
    clearWallEraseHoverHighlight()
    if (target.kind === 'repeat-erase') {
      wallEraseRepeatHoverFillMaterial.color.set(0x4dd0e1)
      wallEraseRepeatHoverWireMaterial.color.set(0x4dd0e1)
      target.preview.meshes.forEach((mesh) => {
        const fillProxy = new THREE.Mesh(mesh.geometry, wallEraseRepeatHoverFillMaterial)
        fillProxy.matrixAutoUpdate = false
        fillProxy.matrix.copy(mesh.matrixWorld)
        fillProxy.renderOrder = 19996
        fillProxy.frustumCulled = false
        ;(fillProxy as any).raycast = () => {}
        wallEraseRepeatHoverGroup.add(fillProxy)

        const wireProxy = new THREE.Mesh(mesh.geometry, wallEraseRepeatHoverWireMaterial)
        wireProxy.matrixAutoUpdate = false
        wireProxy.matrix.copy(mesh.matrixWorld)
        wireProxy.renderOrder = 19997
        wireProxy.frustumCulled = false
        ;(wireProxy as any).raycast = () => {}
        wallEraseRepeatHoverGroup.add(wireProxy)
      })
      target.preview.instancedSlots.forEach((slot) => {
        const fillProxy = new THREE.Mesh(slot.mesh.geometry, wallEraseRepeatHoverFillMaterial)
        fillProxy.matrixAutoUpdate = false
        options.instancedOutlineSync.syncProxyMatrixFromSlot(fillProxy, slot.mesh, slot.index)
        fillProxy.renderOrder = 19996
        fillProxy.frustumCulled = false
        ;(fillProxy as any).raycast = () => {}
        wallEraseRepeatHoverGroup.add(fillProxy)

        const wireProxy = new THREE.Mesh(slot.mesh.geometry, wallEraseRepeatHoverWireMaterial)
        wireProxy.matrixAutoUpdate = false
        options.instancedOutlineSync.syncProxyMatrixFromSlot(wireProxy, slot.mesh, slot.index)
        wireProxy.renderOrder = 19997
        wireProxy.frustumCulled = false
        ;(wireProxy as any).raycast = () => {}
        wallEraseRepeatHoverGroup.add(wireProxy)
      })
      wallEraseRepeatHoverGroup.visible = wallEraseRepeatHoverGroup.children.length > 0
      return wallEraseRepeatHoverGroup.visible
    }

    const isRepair = target.kind === 'stretch-repair'
    const hoverFillMaterial = isRepair ? options.instancedHoverRestoreMaterial : options.instancedHoverMaterial
    if (wallEraseHoverFill.material !== hoverFillMaterial) {
      wallEraseHoverFill.material = hoverFillMaterial
    }
    wallEraseHoverFill.material.opacity = 0.65
    wallEraseHoverEdgeMaterial.color.set(isRepair ? 0xffc107 : 0x4dd0e1)

    wallEraseHoverDirHelper.copy(target.preview.worldB).sub(target.preview.worldA)
    wallEraseHoverDirHelper.y = 0
    const len = wallEraseHoverDirHelper.length()
    if (!Number.isFinite(len) || len <= 1e-6) {
      clearWallEraseHoverHighlight()
      return false
    }

    wallEraseHoverMidHelper.copy(target.preview.worldA).add(target.preview.worldB).multiplyScalar(0.5)
    wallEraseHoverDirHelper.multiplyScalar(1 / len)

    const previewHeight = Number.isFinite(target.preview.height) && target.preview.height > 0
      ? target.preview.height
      : WALL_DEFAULT_HEIGHT
    const previewWidth = Number.isFinite(target.preview.width) && target.preview.width > 0
      ? target.preview.width
      : WALL_DEFAULT_WIDTH
    const padW = Math.max(0.03, previewWidth * 0.15)
    const padH = Math.max(0.05, previewHeight * 0.03)
    const boxWidth = previewWidth + padW
    const boxHeight = previewHeight + padH

    wallEraseHoverUpHelper.set(0, 1, 0)
    wallEraseHoverBasisZHelper.copy(wallEraseHoverDirHelper)
    wallEraseHoverBasisXHelper.crossVectors(wallEraseHoverUpHelper, wallEraseHoverBasisZHelper)
    if (wallEraseHoverBasisXHelper.lengthSq() <= 1e-10) {
      wallEraseHoverBasisXHelper.set(1, 0, 0)
    } else {
      wallEraseHoverBasisXHelper.normalize()
    }
    wallEraseHoverBasisYHelper.crossVectors(wallEraseHoverBasisZHelper, wallEraseHoverBasisXHelper)
    if (wallEraseHoverBasisYHelper.lengthSq() <= 1e-10) {
      wallEraseHoverBasisYHelper.set(0, 1, 0)
    } else {
      wallEraseHoverBasisYHelper.normalize()
    }
    wallEraseHoverMatHelper.makeBasis(wallEraseHoverBasisXHelper, wallEraseHoverBasisYHelper, wallEraseHoverBasisZHelper)
    wallEraseHoverGroup.quaternion.setFromRotationMatrix(wallEraseHoverMatHelper)
    wallEraseHoverGroup.position.copy(wallEraseHoverMidHelper).addScaledVector(wallEraseHoverBasisYHelper, boxHeight * 0.5)
    wallEraseHoverGroup.scale.set(boxWidth, boxHeight, len)
    wallEraseHoverGroup.visible = true
    return true
  }

  function dispose() {
    clearWallEraseHoverHighlight()
    wallEraseHoverGroup.removeFromParent()
    wallEraseRepeatHoverGroup.removeFromParent()
    wallEraseHoverEdgeMaterial.dispose()
    wallEraseRepeatHoverFillMaterial.dispose()
    wallEraseRepeatHoverWireMaterial.dispose()
    wallEraseHoverEdgesGeometry.dispose()
    wallEraseHoverBoxGeometry.dispose()
  }

  return {
    wallEraseHoverGroup,
    wallEraseRepeatHoverGroup,
    clearWallEraseHoverHighlight,
    updateWallEraseHoverHighlight,
    dispose,
  }
}
