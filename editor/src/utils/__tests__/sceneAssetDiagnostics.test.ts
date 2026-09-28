import { describe, expect, it } from 'vitest'
import { DEVICE_ADAPTATION_COMPONENT_TYPE } from '@schema/components'
import {
  buildSceneAssetReferenceSummaryMap,
  collectSceneAssetReferenceRecords,
  validateSceneAssetReferences,
} from '../sceneAssetDiagnostics'

function createScene(nodes: unknown[]) {
  return {
    id: 'scene-1',
    name: 'Scene',
    nodes,
    environment: {},
    groundSettings: {},
    assetCatalog: {},
    assetRegistry: {},
  } as unknown as Parameters<typeof validateSceneAssetReferences>[0]
}

function createNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    name: 'Node',
    children: [],
    components: {},
    ...overrides,
  }
}

describe('scene asset diagnostics', () => {
  it('does not treat a device-adaptation profile ID as an asset reference', () => {
    const scene = createScene([createNode({
      components: {
        [DEVICE_ADAPTATION_COMPONENT_TYPE]: {
          id: 'component-1',
          type: DEVICE_ADAPTATION_COMPONENT_TYPE,
          enabled: true,
          props: { rules: [{ profileId: 'builtin-android', action: 'hide' }] },
        },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})
    const summary = buildSceneAssetReferenceSummaryMap(scene)

    expect(references.some((reference) => reference.assetId === 'builtin-android')).toBe(false)
    expect(report.issues.some((issue) => issue.assetId === 'builtin-android')).toBe(false)
    expect(summary.has('builtin-android')).toBe(false)
  })

  it('continues to validate model assets configured by a device-adaptation rule', () => {
    const scene = createScene([createNode({
      components: {
        [DEVICE_ADAPTATION_COMPONENT_TYPE]: {
          id: 'component-1',
          type: DEVICE_ADAPTATION_COMPONENT_TYPE,
          enabled: true,
          props: {
            rules: [{ profileId: 'builtin-android', action: 'replaceModel', modelAssetId: 'missing-model' }],
          },
        },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})

    expect(references).toContainEqual(expect.objectContaining({
      assetId: 'missing-model',
      path: expect.stringContaining('rules[0].modelAssetId'),
      category: 'component',
    }))
    expect(report.issues).toContainEqual(expect.objectContaining({
      assetId: 'missing-model',
      code: 'missing-catalog-entry',
    }))
  })

  it('continues to treat terrain-scatter profile IDs as asset references', () => {
    const scene = createScene([createNode({
      dynamicMesh: {
        type: 'Ground',
        terrainScatter: { layers: [{ profileId: 'scatter-asset' }] },
      },
    })])

    const references = collectSceneAssetReferenceRecords(scene)
    const report = validateSceneAssetReferences(scene, {})

    expect(references.some((reference) => reference.assetId === 'scatter-asset')).toBe(true)
    expect(report.issues).toContainEqual(expect.objectContaining({
      assetId: 'scatter-asset',
      code: 'missing-catalog-entry',
    }))
  })
})
