/**
 * Runs the real scene-graph builder against a fake resource cache to pin down the
 * device-adaptation loading rules. Lives here because the editor suite is the only
 * vitest setup in the repo, and it already aliases `@schema` to the package source.
 */
import { describe, expect, it } from 'vitest'
import type { SceneJsonExportDocument, SceneNode } from '@schema/core'
import type { SceneGraphBuildOptions, SceneGraphResourceProgress } from '@schema/sceneGraph'
import { buildSceneGraph } from '@schema/sceneGraph'
import type { DeviceAdaptationNodeRule } from '@schema/deviceAdaptation'

const TERRAIN_ASSET = 'terrainGlb'
const TERRAIN_CHILD_ASSET = 'childGlb'
const OTHER_ASSET = 'otherGlb'
const PROFILE_ID = 'profile-low'

function createNode(id: string, overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    nodeType: 'Group',
    children: [],
    ...overrides,
  } as SceneNode
}

/**
 * root
 * └── terrain (TERRAIN_ASSET)      <- carries the adaptation rule under test
 *     └── terrainChild (TERRAIN_CHILD_ASSET)
 * └── other (OTHER_ASSET)          <- control: never adapted
 */
function createDocument(action: DeviceAdaptationNodeRule['action'] | null): SceneJsonExportDocument {
  const terrainChild = createNode('terrainChild', { sourceAssetId: TERRAIN_CHILD_ASSET })
  const terrain = createNode('terrain', { sourceAssetId: TERRAIN_ASSET, children: [terrainChild] })
  const other = createNode('other', { sourceAssetId: OTHER_ASSET })
  if (action) {
    terrain.components = {
      deviceAdaptation: {
        id: 'adaptation-1',
        type: 'deviceAdaptation',
        enabled: true,
        props: { rules: [{ profileId: PROFILE_ID, action, modelAssetId: null }] },
      },
    }
  }
  const root = createNode('root', { children: [terrain, other] })
  return {
    id: 'scene',
    name: 'scene',
    createdAt: null,
    updatedAt: null,
    nodes: [root],
    assetRegistry: {},
    assetPreload: { mesh: { all: [TERRAIN_ASSET, TERRAIN_CHILD_ASSET, OTHER_ASSET], essential: [] } },
    lazyLoadMeshes: false,
  } as unknown as SceneJsonExportDocument
}

/** Records every asset the runtime actually asks for; every other cache call is unused here. */
function createRecordingResourceCache() {
  const requestedAssets: string[] = []
  const resourceCache = {
    setContext() {},
    setHandlers() {},
    async acquireAssetEntry(assetId: string) {
      requestedAssets.push(assetId)
      return null
    },
    getAssetBytes() {
      return null
    },
    releaseAssetBytes() {},
  }
  return { requestedAssets, resourceCache }
}

function createOptions(progress: SceneGraphResourceProgress[]): SceneGraphBuildOptions {
  return {
    lazyLoadMeshes: false,
    deviceProfileId: PROFILE_ID,
    onProgress: (info) => progress.push(info),
    resolveNodeAdaptation: (node) => {
      const component = node.components?.deviceAdaptation
      if (!component || component.enabled === false) {
        return null
      }
      const rules = Array.isArray(component.props?.rules)
        ? component.props.rules as DeviceAdaptationNodeRule[]
        : []
      return rules.find((rule) => rule.profileId === PROFILE_ID) ?? null
    },
  }
}

type RuntimeObject = { name?: string; children: RuntimeObject[]; userData?: Record<string, unknown> }

/** The builder wraps the document root in a scene group, so search by node id. */
function findByNodeId(object: RuntimeObject, nodeId: string): RuntimeObject | null {
  if (object.userData?.nodeId === nodeId) {
    return object
  }
  for (const child of object.children ?? []) {
    const found = findByNodeId(child, nodeId)
    if (found) {
      return found
    }
  }
  return null
}

async function buildWithAction(action: DeviceAdaptationNodeRule['action'] | null) {
  const document = createDocument(action)
  const { requestedAssets, resourceCache } = createRecordingResourceCache()
  const progress: SceneGraphResourceProgress[] = []
  const result = await buildSceneGraph(
    document,
    resourceCache as never,
    createOptions(progress),
  )
  const runtimeRoot = result.root as unknown as RuntimeObject
  return {
    result,
    requestedAssets,
    progress,
    terrainContainer: findByNodeId(runtimeRoot, 'terrain'),
    terrainChildContainer: findByNodeId(runtimeRoot, 'terrainChild'),
  }
}

describe('scene graph device adaptation loading', () => {
  it('builds normally when no rule applies', async () => {
    const { requestedAssets, terrainContainer, terrainChildContainer } = await buildWithAction(null)
    expect(requestedAssets).toContain(TERRAIN_ASSET)
    expect(requestedAssets).toContain(TERRAIN_CHILD_ASSET)
    expect(requestedAssets).toContain(OTHER_ASSET)
    expect(terrainContainer?.name).toBe('terrain')
    expect(terrainChildContainer?.name).toBe('terrainChild')
  })

  it('skip-visual drops only the node visual and keeps building its children', async () => {
    const { requestedAssets, terrainContainer, terrainChildContainer } = await buildWithAction('skip-visual')
    expect(requestedAssets).not.toContain(TERRAIN_ASSET)
    expect(requestedAssets).toContain(TERRAIN_CHILD_ASSET)
    expect(requestedAssets).toContain(OTHER_ASSET)
    expect(terrainContainer?.name).toBe('terrain::visual-skipped')
    expect(terrainChildContainer).not.toBeNull()
  })

  it('skip-subtree drops the node visual and never builds or loads its descendants', async () => {
    const { requestedAssets, progress, terrainContainer, terrainChildContainer } = await buildWithAction('skip-subtree')
    expect(requestedAssets).not.toContain(TERRAIN_ASSET)
    expect(requestedAssets).not.toContain(TERRAIN_CHILD_ASSET)
    expect(requestedAssets).toContain(OTHER_ASSET)
    expect(terrainContainer?.name).toBe('terrain::visual-skipped-subtree')
    expect(terrainContainer?.children).toHaveLength(0)
    expect(terrainChildContainer).toBeNull()
    // Progress expectation must not announce assets that will never load.
    const progressAssetIds = progress.map((info) => info.assetId).filter((assetId): assetId is string => Boolean(assetId))
    expect(progressAssetIds).not.toContain(TERRAIN_ASSET)
    expect(progressAssetIds).not.toContain(TERRAIN_CHILD_ASSET)
    expect(progressAssetIds).toContain(OTHER_ASSET)
  })
})
