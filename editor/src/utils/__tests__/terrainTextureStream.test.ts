import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  attachTerrainTextureStream,
  createTerrainTextureStream,
  findTerrainTextureStreamFrom,
  getAttachedTerrainTextureStream,
  parseTerrainTextureManifest,
  updateAttachedTerrainTextureStreams,
  type TerrainTextureRequest,
} from '@schema/terrainTextureStream'

function buildBoundMesh(textureId: string, position: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  )
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = `bound-${textureId}`
  mesh.userData.plTextureBindings = [
    { slot: 'map', textureId, image: `textures/${textureId}.jpg` },
  ]
  mesh.updateMatrixWorld(true)
  return mesh
}

function makeCameraAtOrigin(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld(true)
  return camera
}

describe('parseTerrainTextureManifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = parseTerrainTextureManifest({
      version: 1,
      glb: 'scene.glb',
      textures: [{ id: 'tex-0001', image: 'textures/tex-0001.jpg' }],
    })
    expect(manifest.version).toBe(1)
    expect(manifest.glb).toBe('scene.glb')
    expect(manifest.textures).toHaveLength(1)
  })

  it('rejects non-object input', () => {
    expect(() => parseTerrainTextureManifest(null)).toThrow()
    expect(() => parseTerrainTextureManifest('{}')).toThrow()
  })

  it('rejects a non-array textures field', () => {
    expect(() => parseTerrainTextureManifest({ textures: 42 })).toThrow()
  })
})

describe('terrain texture stream', () => {
  it('streams textures for visible meshes and binds them to materials', async () => {
    const root = new THREE.Group()
    const mesh = buildBoundMesh('tex-0001', [0, 0, -5])
    root.add(mesh)

    const requests: TerrainTextureRequest[] = []
    const stream = createTerrainTextureStream(root, {
      updateIntervalMs: 0,
      fetchTexture: async (request) => {
        requests.push(request)
        const texture = new THREE.Texture()
        texture.name = request.textureId
        return texture
      },
    })

    const camera = makeCameraAtOrigin()
    stream.update(camera, 1000)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(requests.map((request) => request.textureId)).toEqual(['tex-0001'])
    const material = mesh.material as THREE.MeshStandardMaterial
    expect(material.map?.name).toBe('tex-0001')
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(stream.getStats().loaded).toBe(1)
    stream.dispose()
  })

  it('skips map streaming when base map streaming is disabled', async () => {
    const root = new THREE.Group()
    root.add(buildBoundMesh('tex-0001', [0, 0, -5]))

    const requests: TerrainTextureRequest[] = []
    const stream = createTerrainTextureStream(root, {
      updateIntervalMs: 0,
      baseMapStreamingEnabled: false,
      fetchTexture: async (request) => {
        requests.push(request)
        return new THREE.Texture()
      },
    })

    stream.update(makeCameraAtOrigin(), 1000)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(0)

    stream.setBaseMapStreamingEnabled(true)
    stream.update(makeCameraAtOrigin(), 2000)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)
    stream.dispose()
  })

  it('evicts least recently used textures over the memory budget', async () => {
    const root = new THREE.Group()
    root.add(buildBoundMesh('tex-0001', [0, 0, -5]))
    root.add(buildBoundMesh('tex-0002', [0, 0, -5]))

    const stream = createTerrainTextureStream(root, {
      updateIntervalMs: 0,
      memoryBudgetBytes: 6 * 1024 * 1024,
      fetchTexture: async () => new THREE.Texture(),
    })

    stream.update(makeCameraAtOrigin(), 1000)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    // Both textures are estimated at the 4 MiB fallback (no dimensions), so the
    // 6 MiB budget keeps one resident and evicts the other after the second bind.
    const stats = stream.getStats()
    expect(stats.loaded).toBe(1)
    expect(stats.residentBytes).toBe(4 * 1024 * 1024)
    stream.dispose()
  })

  it('attaches to roots and is discoverable from descendants', () => {
    const root = new THREE.Group()
    const child = new THREE.Group()
    root.add(child)

    const stream = attachTerrainTextureStream(root, { enabled: false })
    expect(getAttachedTerrainTextureStream(root)).toBe(stream)
    expect(findTerrainTextureStreamFrom(child)).toBe(stream)
    stream.dispose()
  })

  it('updates every attached stream from the shared driver', async () => {
    const root = new THREE.Group()
    const mesh = buildBoundMesh('tex-0001', [0, 0, -5])
    root.add(mesh)
    attachTerrainTextureStream(root, {
      updateIntervalMs: 0,
      fetchTexture: async () => new THREE.Texture(),
    })

    updateAttachedTerrainTextureStreams(root, makeCameraAtOrigin(), 1000)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const material = mesh.material as THREE.MeshStandardMaterial
    expect(material.map).toBeInstanceOf(THREE.Texture)
    getAttachedTerrainTextureStream(root)?.dispose()
  })
})
