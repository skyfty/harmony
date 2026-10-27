import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
} from '@schema/components'
import { isProceduralLandscapePlacementArtifact } from '@/utils/proceduralLandscapePlacementArtifact'

describe('procedural landscape placement artifacts', () => {
  it('excludes generated foliage below a procedural landscape node', () => {
    const root = new THREE.Group()
    root.userData[COMPONENT_ARTIFACT_KEY] = true
    root.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = 'landscape'
    const tree = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    root.add(tree)

    expect(isProceduralLandscapePlacementArtifact(tree, (nodeId) => (
      nodeId === 'landscape'
        ? {
            components: {
              [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
                id: 'component',
                type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
                enabled: true,
                props: {},
              },
            },
          }
        : null
    ))).toBe(true)
  })

  it('keeps artifacts owned by unrelated component types', () => {
    const artifact = new THREE.Group()
    artifact.userData[COMPONENT_ARTIFACT_KEY] = true
    artifact.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = 'other'

    expect(isProceduralLandscapePlacementArtifact(artifact, () => ({
      components: {},
    }))).toBe(false)
  })

  it('does not classify regular scene meshes as generated artifacts', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())

    expect(isProceduralLandscapePlacementArtifact(mesh, () => null)).toBe(false)
  })
})
