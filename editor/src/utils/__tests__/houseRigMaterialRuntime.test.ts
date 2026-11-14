import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { HouseRigPartBinding } from '@schema/houseRig'
import {
  clearHouseRigRuntimeSnapshot,
  subscribeHouseRigRuntime,
} from '@schema/components'
import {
  applyHouseRigMaterialEnvironmentPreview,
  buildHouseRigPartMaterialViewMap,
  buildHouseRigRuntimeMaterialSeedMap,
  createHouseRigDefaultMaterial,
  createHouseRigMaterialSeedFromThreeMaterial,
} from '../houseRigMaterialRuntime'

function createPart(overrides: Partial<HouseRigPartBinding> = {}): HouseRigPartBinding {
  return {
    key: '0',
    objectPath: '0',
    meshName: '墙-前-外',
    role: 'wall',
    side: 'front',
    layer: 'outer',
    material: null,
    ...overrides,
  }
}

describe('House Rig runtime material seeds', () => {
  it('preserves the rendered appearance while leaving model textures inherited', () => {
    const material = new THREE.MeshStandardMaterial({
      color: '#336699',
      roughness: 0.42,
      metalness: 0.18,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    })
    material.name = 'Imported Wall'

    const seed = createHouseRigMaterialSeedFromThreeMaterial(material, createPart())

    expect(seed).toMatchObject({
      type: 'MeshStandardMaterial',
      color: '#336699',
      roughness: 0.42,
      metalness: 0.18,
      transparent: true,
      opacity: 0.75,
      side: 'double',
      textures: {},
      textureOverrides: [],
    })
  })

  it('resolves part seeds through the bound object path', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#aa5500' }),
    )
    mesh.name = 'duplicate-name'
    root.add(mesh)

    const seeds = buildHouseRigRuntimeMaterialSeedMap(root, [
      createPart({
        key: 'wall-0',
        objectPath: '0',
        meshName: 'duplicate-name',
      }),
    ])

    expect(seeds.get('wall-0')?.color).toBe('#aa5500')
  })

  it('shows a built-in material and its inherited texture slots', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({
      color: '#227755',
      roughness: 0.36,
    })
    material.name = 'Imported Wall Paint'
    material.map = new THREE.Texture()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    mesh.name = 'wall-built-in'
    root.add(mesh)

    const views = buildHouseRigPartMaterialViewMap(root, [
      createPart({
        key: 'built-in',
        objectPath: '0',
        meshName: 'wall-built-in',
      }),
    ])
    const view = views.get('built-in')
    const beforeMount = buildHouseRigPartMaterialViewMap(null, [
      createPart({
        key: 'built-in',
        objectPath: '0',
        meshName: 'wall-built-in',
      }),
    ]).get('built-in')

    expect(beforeMount?.source).toBe('default')
    expect(view).toMatchObject({
      source: 'builtin',
      sourceLabel: '内置材质：Imported Wall Paint',
      hasBuiltInTextures: true,
      inheritedTextureSlots: ['albedo'],
    })
    expect(view?.material).toMatchObject({
      name: 'Imported Wall Paint',
      color: '#227755',
      roughness: 0.36,
    })
  })

  it('uses a standard white material when runtime material data is unavailable', () => {
    const fallback = createHouseRigDefaultMaterial(createPart())
    const view = buildHouseRigPartMaterialViewMap(null, [createPart()]).get('0')

    expect(fallback).toMatchObject({
      type: 'MeshStandardMaterial',
      color: '#ffffff',
      metalness: 0.1,
      roughness: 1,
      textureOverrides: [],
    })
    expect(view).toMatchObject({
      source: 'default',
      sourceLabel: '默认材质',
      hasBuiltInTextures: false,
    })
    expect(view?.material.id).toBe('house-rig-default:0')
  })

  it('keeps an explicit override ahead of the built-in material', () => {
    const part = createPart()
    const override = createHouseRigMaterialSeedFromThreeMaterial(
      new THREE.MeshStandardMaterial({ color: '#ff0000' }),
      part,
    )
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#0000ff' }),
    )
    mesh.name = part.meshName
    root.add(mesh)

    const view = buildHouseRigPartMaterialViewMap(root, [
      { ...part, material: override },
    ]).get('0')

    expect(view?.source).toBe('override')
    expect(view?.material.color).toBe('#ff0000')
  })

  it('notifies subscribers when runtime snapshots are cleared', () => {
    let notifications = 0
    const unsubscribe = subscribeHouseRigRuntime('runtime-subscribe-test', () => {
      notifications += 1
    })

    clearHouseRigRuntimeSnapshot('runtime-subscribe-test')
    expect(notifications).toBe(1)

    unsubscribe()
    clearHouseRigRuntimeSnapshot('runtime-subscribe-test')
    expect(notifications).toBe(1)
  })

  it('adds a neutral environment only to marked House Rig PBR overrides', () => {
    const environmentMap = new THREE.Texture()
    const standardMaterial = new THREE.MeshStandardMaterial({
      color: '#ac3939',
      metalness: 1,
      roughness: 1,
      envMapIntensity: 0.7,
    })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standardMaterial)
    const config = {
      ...createHouseRigMaterialSeedFromThreeMaterial(standardMaterial, createPart()),
      editorPreviewEnvironment: 'neutral-pbr' as const,
      envMapIntensity: 0.7,
    }

    applyHouseRigMaterialEnvironmentPreview(mesh, config, environmentMap)

    expect(standardMaterial.envMap).toBe(environmentMap)
    expect(standardMaterial.color.getHexString()).toBe('ac3939')
    expect(standardMaterial.metalness).toBe(1)
    expect(standardMaterial.roughness).toBe(1)
    expect(standardMaterial.envMapIntensity).toBe(0.7)
  })

  it('does not inject environment into unmarked or unlit materials', () => {
    const environmentMap = new THREE.Texture()
    const standardMaterial = new THREE.MeshStandardMaterial()
    const standardMesh = new THREE.Mesh(new THREE.BoxGeometry(), standardMaterial)
    const unmarkedConfig = createHouseRigMaterialSeedFromThreeMaterial(
      standardMaterial,
      createPart(),
    )
    applyHouseRigMaterialEnvironmentPreview(standardMesh, unmarkedConfig, environmentMap)
    expect(standardMaterial.envMap).toBeNull()

    const basicMaterial = new THREE.MeshBasicMaterial({ color: '#00ff00' })
    const basicMesh = new THREE.Mesh(new THREE.BoxGeometry(), basicMaterial)
    applyHouseRigMaterialEnvironmentPreview(
      basicMesh,
      {
        ...createHouseRigMaterialSeedFromThreeMaterial(basicMaterial, createPart()),
        editorPreviewEnvironment: 'neutral-pbr',
      },
      environmentMap,
    )
    expect(basicMaterial.envMap).toBeNull()
  })
})
