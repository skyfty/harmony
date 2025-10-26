const wrapMap = {
  ClampToEdgeWrapping: 'ClampToEdgeWrapping',
  RepeatWrapping: 'RepeatWrapping',
  MirroredRepeatWrapping: 'MirroredRepeatWrapping',
}

function mapWrapMode(THREE, key) {
  const constant = wrapMap[key]
  if (!constant) {
    return THREE.ClampToEdgeWrapping
  }
  return THREE[constant] ?? THREE.ClampToEdgeWrapping
}

function hexToColor(THREE, input, fallback = '#ffffff') {
  const color = new THREE.Color()
  try {
    color.set(input || fallback)
  } catch (error) {
    color.set(fallback)
  }
  return color
}

function degToRad(value) {
  return value * (Math.PI / 180)
}

async function loadTexture(THREE, textureLoader, resourceManager, ref) {
  if (!ref?.assetId) {
    return null
  }
  try {
    const asset = await resourceManager.ensureAsset(ref.assetId)
    const texture = await new Promise((resolve, reject) => {
      textureLoader.load(asset.path, resolve, undefined, reject)
    })
    const settings = ref.settings || {}
    texture.wrapS = mapWrapMode(THREE, settings.wrapS)
    texture.wrapT = mapWrapMode(THREE, settings.wrapT)
    if (texture.wrapR !== undefined) {
      texture.wrapR = mapWrapMode(THREE, settings.wrapR)
    }
    if (settings.offset) {
      texture.offset.set(settings.offset.x ?? 0, settings.offset.y ?? 0)
    }
    if (settings.repeat) {
      texture.repeat.set(settings.repeat.x ?? 1, settings.repeat.y ?? 1)
    }
    if (typeof settings.rotation === 'number') {
      texture.rotation = settings.rotation
    }
    if (settings.center) {
      texture.center.set(settings.center.x ?? 0, settings.center.y ?? 0)
    }
    if (typeof settings.flipY === 'boolean') {
      texture.flipY = settings.flipY
    }
    if (typeof settings.generateMipmaps === 'boolean') {
      texture.generateMipmaps = settings.generateMipmaps
    }
    if (typeof settings.premultiplyAlpha === 'boolean') {
      texture.premultiplyAlpha = settings.premultiplyAlpha
    }
    texture.needsUpdate = true
    return texture
  } catch (error) {
    console.warn('加载纹理失败', ref.assetId, error)
    return null
  }
}

async function createMaterial(THREE, textureLoader, resourceManager, materialDef) {
  const material = new THREE.MeshStandardMaterial({
    color: hexToColor(THREE, materialDef?.color).getHex(),
    metalness: materialDef?.metalness ?? 0.5,
    roughness: materialDef?.roughness ?? 0.5,
    emissive: hexToColor(THREE, materialDef?.emissive, '#000000'),
    emissiveIntensity: materialDef?.emissiveIntensity ?? 0,
    transparent: materialDef?.transparent ?? false,
    opacity: materialDef?.opacity ?? 1,
    wireframe: materialDef?.wireframe ?? false,
  })

  if (materialDef?.side === 'double') {
    material.side = THREE.DoubleSide
  } else if (materialDef?.side === 'back') {
    material.side = THREE.BackSide
  }

  if (materialDef?.textures) {
    const entries = Object.entries(materialDef.textures)
    for (const [name, ref] of entries) {
      if (!ref) {
        continue
      }
      const texture = await loadTexture(THREE, textureLoader, resourceManager, ref)
      if (!texture) {
        continue
      }
      switch (name) {
        case 'albedo':
          material.map = texture
          break
        case 'normal':
          material.normalMap = texture
          break
        case 'metalness':
          material.metalnessMap = texture
          break
        case 'roughness':
          material.roughnessMap = texture
          break
        case 'ao':
          material.aoMap = texture
          break
        case 'emissive':
          material.emissiveMap = texture
          break
        default:
          break
      }
    }
  }

  return material
}

function createPrimitiveMesh(THREE, node) {
  const type = node.nodeType
  const geometryMap = {
    Box: () => new THREE.BoxGeometry(1, 1, 1),
    Sphere: () => new THREE.SphereGeometry(1, 32, 32),
    Capsule: () => new THREE.CapsuleGeometry(1, 1, 4, 8),
    Cylinder: () => new THREE.CylinderGeometry(1, 1, 1, 32),
    Plane: () => new THREE.PlaneGeometry(1, 1, 1, 1),
    Circle: () => new THREE.CircleGeometry(1, 32),
    Ring: () => new THREE.RingGeometry(0.5, 1, 32),
    Torus: () => new THREE.TorusGeometry(1, 0.3, 16, 100),
    TorusKnot: () => new THREE.TorusKnotGeometry(1, 0.3, 64, 12),
    Icosahedron: () => new THREE.IcosahedronGeometry(1, 0),
    Dodecahedron: () => new THREE.DodecahedronGeometry(1, 0),
    Octahedron: () => new THREE.OctahedronGeometry(1, 0),
  }
  const factory = geometryMap[type] || geometryMap.Box
  const geometry = factory()
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function applyTransform(object, node) {
  object.position.set(node.position?.x ?? 0, node.position?.y ?? 0, node.position?.z ?? 0)
  object.rotation.set(node.rotation?.x ?? 0, node.rotation?.y ?? 0, node.rotation?.z ?? 0)
  object.scale.set(node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1)
  object.visible = node.visible !== false
}

function createLight(THREE, node) {
  const props = node.light || {}
  const type = props.type || 'Directional'
  const color = hexToColor(THREE, props.color || '#ffffff').getHex()
  const intensity = props.intensity ?? 1
  let light
  switch (type) {
    case 'Ambient':
      light = new THREE.AmbientLight(color, intensity)
      break
    case 'Point':
      light = new THREE.PointLight(color, intensity, props.distance ?? 0, props.decay ?? 2)
      break
    case 'Spot':
      light = new THREE.SpotLight(color, intensity, props.distance ?? 0, props.angle ?? degToRad(45), props.penumbra ?? 0, props.decay ?? 1)
      break
    default:
      light = new THREE.DirectionalLight(color, intensity)
      break
  }
  if (props.target) {
    light.target.position.set(props.target.x ?? 0, props.target.y ?? 0, props.target.z ?? 0)
  }
  light.castShadow = props.castShadow ?? false
  return light
}

async function createRuntimeObject(THREE, loaders, resourceManager, node) {
  if (node.nodeType === 'Group') {
    return new THREE.Group()
  }
  if (node.nodeType === 'Light') {
    return createLight(THREE, node)
  }
  if (node.nodeType === 'Camera') {
    return new THREE.Object3D()
  }

  if (node.sourceAssetId) {
    const asset = await resourceManager.ensureAsset(node.sourceAssetId)
    return new Promise((resolve, reject) => {
      loaders.gltf.load(
        asset.path,
        (gltf) => {
          const root = gltf.scene || gltf.scenes?.[0]
          if (!root) {
            reject(new Error('GLTF 场景为空'))
            return
          }
          resolve(root)
        },
        undefined,
        (error) => reject(error),
      )
    })
  }

  if (node.dynamicMesh?.type === 'Ground') {
    const { width, depth } = node.dynamicMesh
    const geometry = new THREE.PlaneGeometry(width ?? 10, depth ?? 10, node.dynamicMesh.columns ?? 10, node.dynamicMesh.rows ?? 10)
    const material = new THREE.MeshStandardMaterial({ color: 0x6b7280 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    return mesh
  }

  return createPrimitiveMesh(THREE, node)
}

async function applyMaterials(THREE, textureLoader, resourceManager, node, object) {
  if (!Array.isArray(node.materials) || !object.isMesh) {
    return
  }
  if (node.materials.length === 1) {
    object.material = await createMaterial(THREE, textureLoader, resourceManager, node.materials[0])
    return
  }
  const materials = []
  for (const materialDef of node.materials) {
    materials.push(await createMaterial(THREE, textureLoader, resourceManager, materialDef))
  }
  object.material = materials
}

async function attachChildren(THREE, loaders, textureLoader, resourceManager, parentObject, children) {
  for (const childNode of children) {
    const childObject = await buildNode(THREE, loaders, textureLoader, resourceManager, childNode)
    if (childObject) {
      parentObject.add(childObject)
    }
  }
}

async function buildNode(THREE, loaders, textureLoader, resourceManager, node) {
  const object = await createRuntimeObject(THREE, loaders, resourceManager, node)
  if (!object) {
    return null
  }
  applyTransform(object, node)
  await applyMaterials(THREE, textureLoader, resourceManager, node, object)
  if (Array.isArray(node.children) && node.children.length) {
    await attachChildren(THREE, loaders, textureLoader, resourceManager, object, node.children)
  }
  object.name = node.name || node.id
  return object
}

export async function buildSceneGraph({ THREE, loaders, textureLoader, resourceManager, sceneDocument }) {
  const root = new THREE.Group()
  for (const node of sceneDocument.nodes || []) {
    const object = await buildNode(THREE, loaders, textureLoader, resourceManager, node)
    if (object) {
      root.add(object)
    }
  }
  return root
}

export function applyCameraState(camera, sceneDocument) {
  const state = sceneDocument.camera || {}
  const position = state.position || { x: 0, y: 2, z: 10 }
  const target = state.target || { x: 0, y: 0, z: 0 }
  camera.position.set(position.x ?? 0, position.y ?? 2, position.z ?? 10)
  camera.lookAt(target.x ?? 0, target.y ?? 0, target.z ?? 0)
  if (typeof state.fov === 'number') {
    camera.fov = state.fov
    camera.updateProjectionMatrix()
  }
}
