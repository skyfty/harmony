import * as THREE from 'three'

/**
 * UV fallback for imported meshes that carry no texture coordinates.
 *
 * glTF meshes are allowed to ship without `TEXCOORD_0`; such a surface can never
 * display a texture - every fragment samples the same texel, so a dropped texture
 * shows up as one flat colour (the mesh keeps rendering with its base colour /
 * the model's own single-texel sample). GLB/FBX exporters do produce such files,
 * for example scanned or decimated models, or models whose UVs were stripped by
 * a conversion step in an external tool.
 *
 * For those meshes we build a box projection from the vertex positions: each
 * vertex is projected along the axis its normal points at, which is the standard
 * fallback for tiling surface textures. UV units are object-local units (glTF is
 * defined in meters), so the material's existing "tile size (meters)" control
 * keeps working through the regular auto-tiling info.
 */
export const GENERATED_UV_STATE_KEY = '__harmonyGeneratedUv'
export const GENERATED_UV_ORIGINAL_GEOMETRY_KEY = '__harmonyGeneratedUvOriginalGeometry'

export type GeneratedUvState = 'existing' | 'aliased' | 'generated' | 'skipped-instanced' | 'skipped-no-position'

/** Attribute names other exporters use for the first UV set. */
const UV_ALIAS_PATTERNS: RegExp[] = [
  // st / uv1 / uvs / texcoord _0 / TEXCOORD_0 / textureCoordinate0 ...
  /^(?:st|uvs|uv|texcoord|texturecoordinate)_?[0-9]*$/iu,
]

export function findAliasableUvAttributeName(geometry: THREE.BufferGeometry | null | undefined): string | null {
  if (!geometry?.attributes) {
    return null
  }
  return Object.keys(geometry.attributes)
    .find((name) => UV_ALIAS_PATTERNS.some((pattern) => pattern.test(name))) ?? null
}

function buildBoxProjectedUvs(geometry: THREE.BufferGeometry): THREE.BufferAttribute | null {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position || position.itemSize < 3 || position.count <= 0) {
    return null
  }
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
  const count = position.count
  const uvs = new Float32Array(count * 2)
  for (let index = 0; index < count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const nx = normal ? normal.getX(index) : 0
    const ny = normal ? normal.getY(index) : 0
    const nz = normal ? normal.getZ(index) : 1
    const ax = Math.abs(nx)
    const ay = Math.abs(ny)
    const az = Math.abs(nz)
    let u: number
    let v: number
    if (ax >= ay && ax >= az) {
      u = nz >= 0 ? z : -z
      v = y
    } else if (ay >= ax && ay >= az) {
      u = x
      v = nz >= 0 ? z : -z
    } else {
      u = nx >= 0 ? x : -x
      v = y
    }
    uvs[index * 2] = Number.isFinite(u) ? u : 0
    uvs[index * 2 + 1] = Number.isFinite(v) ? v : 0
  }
  return new THREE.BufferAttribute(uvs, 2)
}

function takeGeometryForEditing(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const userData = (mesh.userData ?? (mesh.userData = {})) as Record<string, unknown>
  if (userData[GENERATED_UV_ORIGINAL_GEOMETRY_KEY] === undefined) {
    userData[GENERATED_UV_ORIGINAL_GEOMETRY_KEY] = geometry
  }
  // Geometry is shared with the asset cache (and with other nodes using the same
  // asset), so every mutation happens on a per-node copy.
  const cloned = geometry.clone()
  mesh.geometry = cloned
  return cloned
}

/**
 * Guarantees `geometry.attributes.uv` for a mesh that has to display a texture.
 * Idempotent: meshes that already own a `uv` attribute are left untouched.
 */
export function ensureMeshUvForTextures(mesh: THREE.Mesh | null | undefined): GeneratedUvState {
  if (!mesh?.isMesh) {
    return 'skipped-no-position'
  }
  const currentGeometry = mesh.geometry as THREE.BufferGeometry | null | undefined
  if (!currentGeometry || typeof currentGeometry.getAttribute !== 'function') {
    return 'skipped-no-position'
  }
  if (currentGeometry.getAttribute('uv')) {
    return 'existing'
  }
  if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
    // InstancedMesh geometry carries the instance matrix; cloning it here would
    // detach the mesh's own instanceMatrix. Those meshes come from assets that
    // are baked by the editor and keep their source UVs.
    ;(mesh.userData ?? (mesh.userData = {}))[GENERATED_UV_STATE_KEY] = 'skipped-instanced' satisfies GeneratedUvState
    return 'skipped-instanced'
  }

  const aliasName = findAliasableUvAttributeName(currentGeometry)
  if (aliasName) {
    const edited = takeGeometryForEditing(mesh, currentGeometry)
    const source = edited.getAttribute(aliasName)
    if (source) {
      edited.setAttribute('uv', source.clone())
      ;(mesh.userData ?? (mesh.userData = {}))[GENERATED_UV_STATE_KEY] = 'aliased' satisfies GeneratedUvState
      return 'aliased'
    }
  }

  const generated = buildBoxProjectedUvs(currentGeometry)
  if (!generated) {
    ;(mesh.userData ?? (mesh.userData = {}))[GENERATED_UV_STATE_KEY] = 'skipped-no-position' satisfies GeneratedUvState
    return 'skipped-no-position'
  }

  const edited = takeGeometryForEditing(mesh, currentGeometry)
  edited.setAttribute('uv', generated)
  edited.computeBoundingBox?.()
  edited.computeBoundingSphere?.()
  // Box projection uses object-local units (meters) - the caller attaches the
  // matching auto-tiling info so the material's tile-size control keeps working.
  ;(mesh.userData ?? (mesh.userData = {}))[GENERATED_UV_STATE_KEY] = 'generated' satisfies GeneratedUvState
  return 'generated'
}
