import * as THREE from 'three'
import { COMPONENT_ARTIFACT_KEY } from '../components/componentManager'

/**
 * Crossed-quad billboard cards, mirroring slowroads' foliage sprites: two
 * vertical quads crossed around the Y axis, lit from above, alpha-tested,
 * optionally wind-swayed and distance faded.
 */
export function createCrossQuadGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    0.5, 1, 0,
    -0.5, 1, 0,
    0, 0, -0.5,
    0, 0, 0.5,
    0, 1, 0.5,
    0, 1, -0.5,
  ])
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ])
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), Math.SQRT2)
  return geometry
}

export interface FoliageShaderUniforms {
  time: THREE.IUniform<number>
  windStrength: THREE.IUniform<number>
  cameraPosition: THREE.IUniform<THREE.Vector3>
  fadeStart: THREE.IUniform<number>
  fadeEnd: THREE.IUniform<number>
}

export function createFoliageShaderUniforms(): FoliageShaderUniforms {
  return {
    time: { value: 0 },
    windStrength: { value: 0 },
    cameraPosition: { value: new THREE.Vector3() },
    fadeStart: { value: 400 },
    fadeEnd: { value: 460 },
  }
}

export function createFoliageMaterial(options: {
  map: THREE.Texture
  uniforms: FoliageShaderUniforms
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: options.map,
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPlTime = options.uniforms.time
    shader.uniforms.uPlWindStrength = options.uniforms.windStrength
    shader.uniforms.uPlCamPos = options.uniforms.cameraPosition
    shader.uniforms.uPlFadeStart = options.uniforms.fadeStart
    shader.uniforms.uPlFadeEnd = options.uniforms.fadeEnd

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPlTime;
uniform float uPlWindStrength;
uniform vec3 uPlCamPos;
uniform float uPlFadeStart;
uniform float uPlFadeEnd;
varying float vPlFade;
varying float vPlPhase;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec4 plInstanceWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#else
  vec4 plInstanceWorld = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
#endif
vPlPhase = fract(sin(dot(plInstanceWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
vPlFade = 1.0 - smoothstep(uPlFadeStart, uPlFadeEnd, distance(plInstanceWorld.xyz, uPlCamPos));
if (uPlWindStrength > 0.0) {
  float plHeight = clamp(position.y, 0.0, 1.0);
  float plSway = sin(uPlTime * 1.6 + vPlPhase * 6.28318) * uPlWindStrength * plHeight * plHeight;
  transformed.x += plSway * 0.5;
  transformed.z += plSway * 0.35;
}`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vPlFade;
varying float vPlPhase;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb *= 0.86 + 0.28 * fract(vPlPhase * 7.13);
diffuseColor.a *= clamp(vPlFade, 0.0, 1.0);`,
      )
  }
  material.customProgramCacheKey = () => 'pl-foliage-v1'
  return material
}

const scratchPosition = new THREE.Vector3()
const scratchEuler = new THREE.Euler()
const scratchQuaternion = new THREE.Quaternion()
const scratchScale = new THREE.Vector3()
const scratchMatrix = new THREE.Matrix4()

export function composeFoliageMatrices(
  placements: ReadonlyArray<{ x: number; y: number; z: number; rotation: number; scale: number }>,
  hostInverse: THREE.Matrix4 | null,
): Float32Array {
  const out = new Float32Array(placements.length * 16)
  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i]!
    scratchPosition.set(placement.x, placement.y, placement.z)
    scratchEuler.set(0, placement.rotation, 0)
    scratchQuaternion.setFromEuler(scratchEuler)
    const scale = Math.max(0.05, placement.scale)
    scratchScale.set(scale, scale, scale)
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
    if (hostInverse) {
      scratchMatrix.premultiply(hostInverse)
    }
    scratchMatrix.toArray(out, i * 16)
  }
  return out
}

export interface FoliageInstanceArrays {
  count: number
  matrices: Float32Array
}

const MAX_SPARE_MESHES_PER_ASSET = 12

export class FoliageBatchManager {
  private readonly geometry: THREE.BufferGeometry
  private readonly spareByAsset = new Map<string, THREE.InstancedMesh[]>()
  private readonly liveMeshes = new Set<THREE.InstancedMesh>()

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry
  }

  get liveMeshCount(): number {
    return this.liveMeshes.size
  }

  acquireMesh(assetKey: string, count: number, material: THREE.Material): THREE.InstancedMesh {
    const capacityNeeded = Math.max(1, count)
    const spare = this.spareByAsset.get(assetKey)
    let mesh: THREE.InstancedMesh | null = null
    if (spare && spare.length) {
      const index = spare.findIndex((candidate) => candidate.instanceMatrix.array.length / 16 >= capacityNeeded)
      if (index >= 0) {
        mesh = spare.splice(index, 1)[0]!
      }
    }
    if (!mesh) {
      mesh = new THREE.InstancedMesh(this.geometry, material, capacityNeeded)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = true
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.matrixAutoUpdate = false
    }
    mesh.count = capacityNeeded
    mesh.material = material
    mesh.boundingSphere = null
    this.liveMeshes.add(mesh)
    return mesh
  }

  releaseMesh(assetKey: string, mesh: THREE.InstancedMesh): void {
    this.liveMeshes.delete(mesh)
    mesh.count = 0
    const spare = this.spareByAsset.get(assetKey) ?? []
    spare.push(mesh)
    while (spare.length > MAX_SPARE_MESHES_PER_ASSET) {
      const removed = spare.shift()
      removed?.dispose()
    }
    this.spareByAsset.set(assetKey, spare)
  }

  dispose(): void {
    for (const mesh of this.liveMeshes) {
      mesh.dispose()
    }
    this.liveMeshes.clear()
    for (const spare of this.spareByAsset.values()) {
      for (const mesh of spare) {
        mesh.dispose()
      }
    }
    this.spareByAsset.clear()
  }
}

export class FoliageBatch {
  readonly group = new THREE.Group()
  private readonly entries: Array<{ assetKey: string; mesh: THREE.InstancedMesh }> = []
  private disposed = false
  private readonly manager: FoliageBatchManager

  constructor(manager: FoliageBatchManager) {
    this.manager = manager
    this.group.userData[COMPONENT_ARTIFACT_KEY] = true
    this.group.name = '__ProceduralLandscapeBatch'
  }

  add(assetKey: string, instances: FoliageInstanceArrays, material: THREE.Material): number {
    if (this.disposed || instances.count <= 0) {
      return 0
    }
    const mesh = this.manager.acquireMesh(assetKey, instances.count, material)
    const array = mesh.instanceMatrix.array as Float32Array
    array.set(instances.matrices.subarray(0, instances.count * 16), 0)
    mesh.instanceMatrix.needsUpdate = true
    const computeBounds = (mesh as THREE.InstancedMesh & { computeBoundingSphere?: () => void }).computeBoundingSphere
    if (typeof computeBounds === 'function') {
      computeBounds.call(mesh)
    } else {
      mesh.frustumCulled = false
    }
    this.entries.push({ assetKey, mesh })
    this.group.add(mesh)
    return instances.count
  }

  get instanceCount(): number {
    return this.entries.reduce((sum, entry) => sum + entry.mesh.count, 0)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const entry of this.entries) {
      this.manager.releaseMesh(entry.assetKey, entry.mesh)
    }
    this.entries.length = 0
    this.group.removeFromParent()
    this.group.clear()
  }
}
