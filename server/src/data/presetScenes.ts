import { GROUND_NODE_ID, SKY_NODE_ID, ENVIRONMENT_NODE_ID } from '@harmony/schema'
import type { PresetSceneDetail } from '@/types/presetScene'

const SCENE_TIMESTAMP = '2024-01-01T00:00:00.000Z'

const DEFAULT_TEXTURE_SLOTS = {
  albedo: null,
  normal: null,
  metalness: null,
  roughness: null,
  ao: null,
  emissive: null,
} as const

interface Vector3LikeLiteral {
  x: number
  y: number
  z: number
}

const vec3 = (x: number, y: number, z: number): Vector3LikeLiteral => ({ x, y, z })

const createNodeMaterial = (
  id: string,
  color: string,
  options: {
    name?: string
    metalness?: number
    roughness?: number
    emissive?: string
    emissiveIntensity?: number
  } = {},
) => ({
  id,
  materialId: null,
  name: options.name ?? 'Preset Material',
  type: 'MeshStandardMaterial',
  color,
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: options.metalness ?? 0.15,
  roughness: options.roughness ?? 0.75,
  emissive: options.emissive ?? '#000000',
  emissiveIntensity: options.emissiveIntensity ?? 0,
  aoStrength: 1,
  envMapIntensity: 1,
  textures: { ...DEFAULT_TEXTURE_SLOTS },
})

const createGroundNode = (width: number, depth: number, color: string) => ({
  id: GROUND_NODE_ID,
  name: 'Ground',
  nodeType: 'Mesh',
  selectedHighlight: false,
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: true,
  materials: [createNodeMaterial('preset-ground-material', color, { name: 'Ground Material', metalness: 0, roughness: 0.85 })],
  dynamicMesh: {
    type: 'Ground',
    width,
    depth,
    rows: Math.max(1, Math.round(depth)),
    columns: Math.max(1, Math.round(width)),
    cellSize: 1,
    heightMap: {},
    terrainScatterInstancesUpdatedAt: 0,
    textureDataUrl: null,
    textureName: null,
  },
})

type SceneNodeDetail = {
  id: string
  dynamicMesh?: { type?: string }
  [key: string]: unknown
}

const createSkyNode = (): SceneNodeDetail => ({
  id: SKY_NODE_ID,
  name: 'Sky',
  nodeType: 'Group',
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: true,
  children: [],
  materials: [],
})

const DEFAULT_ENVIRONMENT_SETTINGS = {
  background: {
    mode: 'solidColor' as const,
    solidColor: '#516175',
    hdriAssetId: null,
  },
  ambientLightColor: '#ffffff',
  ambientLightIntensity: 0.6,
  fogMode: 'none' as const,
  fogColor: '#516175',
  fogDensity: 0.02,
  environmentMap: {
    mode: 'skybox' as const,
    hdriAssetId: null,
  },
  gravityStrength: 9.81,
  collisionRestitution: 0.2,
  collisionFriction: 0.3,
}

const createEnvironmentNode = (): SceneNodeDetail => ({
  id: ENVIRONMENT_NODE_ID,
  name: 'Environment',
  nodeType: 'Group',
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: true,
  userData: {
    environment: DEFAULT_ENVIRONMENT_SETTINGS,
  },
  materials: [],
  children: undefined,
})

const withEnvironmentNodes = (nodes?: SceneNodeDetail[] | null): SceneNodeDetail[] => {
  const source = Array.isArray(nodes) ? nodes : []
  let skyNode: SceneNodeDetail | null = null
  let environmentNode: SceneNodeDetail | null = null
  const others: SceneNodeDetail[] = []

  source.forEach((node) => {
    if (!skyNode && node.id === SKY_NODE_ID) {
      skyNode = createSkyNode()
      return
    }
    if (!environmentNode && node.id === ENVIRONMENT_NODE_ID) {
      environmentNode = createEnvironmentNode()
      return
    }
    if (node.id !== SKY_NODE_ID && node.id !== ENVIRONMENT_NODE_ID) {
      others.push(node)
    }
  })

  const result = [...others]

  if (!skyNode) {
    skyNode = createSkyNode()
  }
  const groundIndex = result.findIndex((node) => node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground')
  const skyInsertIndex = groundIndex >= 0 ? groundIndex + 1 : 0
  result.splice(skyInsertIndex, 0, skyNode)

  if (!environmentNode) {
    environmentNode = createEnvironmentNode()
  }
  const updatedSkyIndex = result.findIndex((node) => node.id === SKY_NODE_ID)
  const environmentInsertIndex = updatedSkyIndex >= 0 ? updatedSkyIndex + 1 : skyInsertIndex
  result.splice(environmentInsertIndex, 0, environmentNode)

  return result
}

const createRectangleWallSegments = (width: number, depth: number, height: number, thickness: number) => {
  const halfW = width / 2
  const halfD = depth / 2
  return [
    { start: vec3(-halfW, 0, -halfD), end: vec3(halfW, 0, -halfD), height, width, thickness },
    { start: vec3(halfW, 0, -halfD), end: vec3(halfW, 0, halfD), height, width: depth, thickness },
    { start: vec3(halfW, 0, halfD), end: vec3(-halfW, 0, halfD), height, width, thickness },
    { start: vec3(-halfW, 0, halfD), end: vec3(-halfW, 0, -halfD), height, width: depth, thickness },
  ]
}

const createWallNode = (
  id: string,
  name: string,
  options: { width: number; depth: number; height: number; thickness: number; color: string },
) => ({
  id,
  name,
  nodeType: 'Mesh',
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: true,
  materials: [createNodeMaterial(`${id}-material`, options.color, { name: `${name} 材质`, metalness: 0.05, roughness: 0.65 })],
  dynamicMesh: {
    type: 'Wall',
    segments: createRectangleWallSegments(options.width, options.depth, options.height, options.thickness),
  },
})

const createStraightWallNode = (
  id: string,
  name: string,
  options: { start: Vector3LikeLiteral; end: Vector3LikeLiteral; height: number; thickness: number; color: string },
) => ({
  id,
  name,
  nodeType: 'Mesh',
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: false,
  materials: [createNodeMaterial(`${id}-material`, options.color, { name: `${name} 材质`, roughness: 0.6 })],
  dynamicMesh: {
    type: 'Wall',
    segments: [
      {
        start: options.start,
        end: options.end,
        height: options.height,
        width: Math.hypot(options.end.x - options.start.x, options.end.z - options.start.z),
        thickness: options.thickness,
      },
    ],
  },
})

const createBoxNodeFromFootprint = (
  id: string,
  name: string,
  options: { footprint: Array<[number, number]>; height: number; position?: Vector3LikeLiteral; color: string; roughness?: number },
) => {
  const footprint = Array.isArray(options.footprint) ? options.footprint : []
  const xs = footprint.map(([x]) => x)
  const zs = footprint.map(([, z]) => z)
  const minX = xs.length ? Math.min(...xs) : 0
  const maxX = xs.length ? Math.max(...xs) : 0
  const minZ = zs.length ? Math.min(...zs) : 0
  const maxZ = zs.length ? Math.max(...zs) : 0
  const width = Math.max(1e-6, maxX - minX)
  const depth = Math.max(1e-6, maxZ - minZ)
  const height = Math.max(1e-6, options.height)
  const centerX = (minX + maxX) * 0.5
  const centerZ = (minZ + maxZ) * 0.5
  const basePosition = options.position ?? vec3(0, 0, 0)

  return {
    id,
    name,
    nodeType: 'Box',
    position: vec3(basePosition.x + centerX, basePosition.y + height * 0.5, basePosition.z + centerZ),
    rotation: vec3(0, 0, 0),
    scale: vec3(width, height, depth),
    offset: vec3(0, 0, 0),
    visible: true,
    locked: false,
    materials: [createNodeMaterial(`${id}-material`, options.color, { name: `${name} 材质`, roughness: options.roughness ?? 0.6 })],
  }
}

const createLightNode = (
  id: string,
  name: string,
  options: {
    type: 'Spot' | 'Point' | 'Directional'
    position: Vector3LikeLiteral
    color: string
    intensity: number
    angle?: number
    distance?: number
  },
) => ({
  id,
  name,
  nodeType: 'Light',
  position: options.position,
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: false,
  light: {
    type: options.type,
    color: options.color,
    intensity: options.intensity,
    angle: options.angle,
    distance: options.distance,
    target: options.type === 'Directional' ? vec3(0, 0, 0) : undefined,
    castShadow: options.type !== 'Point',
  },
})

const createGroupNode = (id: string, name: string, children: unknown[]) => ({
  id,
  name,
  nodeType: 'Group',
  position: vec3(0, 0, 0),
  rotation: vec3(0, 0, 0),
  scale: vec3(1, 1, 1),
  offset: vec3(0, 0, 0),
  visible: true,
  locked: false,
  children,
})

const createTreeGroup = (id: string, name: string, position: Vector3LikeLiteral) => {
  const trunk = createBoxNodeFromFootprint(`${id}-trunk`, `${name} 树干`, {
    footprint: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    height: 4,
    position,
    color: '#6b4a2d',
    roughness: 0.9,
  })

  const canopy = createBoxNodeFromFootprint(`${id}-canopy`, `${name} 树冠`, {
    footprint: [
      [-3, -3],
      [3, -3],
      [3, 3],
      [-3, 3],
    ],
    height: 3,
    position: vec3(position.x, position.y + 4, position.z),
    color: '#2f7a38',
    roughness: 0.5,
  })

  return createGroupNode(id, name, [trunk, canopy])
}

const createFlowerPatch = (id: string, name: string, position: Vector3LikeLiteral, color: string) =>
  createBoxNodeFromFootprint(id, name, {
    footprint: [
      [-1.6, -1.6],
      [1.6, -1.6],
      [1.6, 1.6],
      [-1.6, 1.6],
    ],
    height: 0.6,
    position,
    color,
    roughness: 0.55,
  })

const createUmbrellaGroup = (id: string, name: string, position: Vector3LikeLiteral, canopyColor: string) => {
  const pole = createBoxNodeFromFootprint(`${id}-pole`, `${name} 立柱`, {
    footprint: [
      [-0.4, -0.4],
      [0.4, -0.4],
      [0.4, 0.4],
      [-0.4, 0.4],
    ],
    height: 3.2,
    position,
    color: '#c7b8a4',
    roughness: 0.75,
  })

  const canopy = createBoxNodeFromFootprint(`${id}-canopy`, `${name} 伞篷`, {
    footprint: [
      [-4, -4],
      [4, -4],
      [4, 4],
      [-4, 4],
    ],
    height: 0.6,
    position: vec3(position.x, position.y + 3.2, position.z),
    color: canopyColor,
    roughness: 0.35,
  })

  return createGroupNode(id, name, [pole, canopy])
}

const createLoungeChair = (id: string, name: string, position: Vector3LikeLiteral) =>
  createBoxNodeFromFootprint(id, name, {
    footprint: [
      [-3, -1.2],
      [3, -1.2],
      [3, 1.2],
      [-3, 1.2],
    ],
    height: 0.8,
    position,
    color: '#deb887',
    roughness: 0.6,
  })

const baseDocument = (overrides: Partial<PresetSceneDetail['document']>): PresetSceneDetail['document'] => {
  const legacyViewport = overrides.viewportSettings as (PresetSceneDetail['document']['viewportSettings'] & {
    skybox?: Record<string, unknown>
    shadowsEnabled?: boolean
  }) | undefined

  const viewportSettings = {
    showGrid: typeof legacyViewport?.showGrid === 'boolean' ? legacyViewport.showGrid : true,
    showAxes: typeof legacyViewport?.showAxes === 'boolean' ? legacyViewport.showAxes : true,
    cameraProjection:
      typeof legacyViewport?.cameraProjection === 'string' ? legacyViewport.cameraProjection : 'perspective',
    cameraControlMode:
      typeof legacyViewport?.cameraControlMode === 'string' ? legacyViewport.cameraControlMode : 'orbit',
  }

  const skybox = (overrides.skybox ?? legacyViewport?.skybox ?? {
    presetId: 'clear-day',
    exposure: 0.6,
    turbidity: 4,
    rayleigh: 1.25,
    mieCoefficient: 0.0025,
    mieDirectionalG: 0.75,
    elevation: 25,
    azimuth: 155,
  }) as Record<string, unknown>

  const shadowsEnabled = overrides.shadowsEnabled ?? legacyViewport?.shadowsEnabled ?? true

  return {
    name: overrides.name ?? '未命名预置场景',
    thumbnail: overrides.thumbnail ?? null,
    nodes: withEnvironmentNodes(overrides.nodes as SceneNodeDetail[] | undefined),
    materials: overrides.materials ?? [],
    selectedNodeId: overrides.selectedNodeId ?? GROUND_NODE_ID,
    selectedNodeIds: overrides.selectedNodeIds ?? [GROUND_NODE_ID],
    camera: overrides.camera ?? {
      position: vec3(32, 20, 32),
      target: vec3(0, 0, 0),
      fov: 60,
      forward: vec3(-0.64, -0.40, -0.64),
    },
    viewportSettings,
    skybox,
    shadowsEnabled,
  groundSettings: overrides.groundSettings ?? { width: 140, depth: 140 },
  panelVisibility: overrides.panelVisibility ?? { hierarchy: false, inspector: false, project: true },
  panelPlacement: overrides.panelPlacement ?? { hierarchy: 'floating', inspector: 'floating', project: 'docked' },
  resourceProviderId: overrides.resourceProviderId ?? 'builtin',
  createdAt: overrides.createdAt ?? SCENE_TIMESTAMP,
  updatedAt: overrides.updatedAt ?? SCENE_TIMESTAMP,
  assetCatalog: overrides.assetCatalog ?? {},
  assetIndex: overrides.assetIndex ?? {},
    packageAssetMap: overrides.packageAssetMap ?? {},
  }
}

export const PRESET_SCENES: PresetSceneDetail[] = [
  {
    id: 'blank-foundation',
    name: '空白场景',
    thumbnailUrl: 'https://dummyimage.com/320x180/4a4a4a/ffffff&text=Blank',
    description: '包含一个基础地面，可从零开始搭建任何内容。',
    document: baseDocument({
      name: '空白场景',
      nodes: [createGroundNode(140, 140, '#6f6f6f')],
      materials: [],
      groundSettings: { width: 140, depth: 140 },
      camera: {
        position: vec3(34, 22, 34),
        target: vec3(0, 0, 0),
        fov: 60,
        forward: vec3(-0.65, -0.42, -0.65),
      },
    }),
  },
  {
    id: 'simple-room',
    name: '简单房间场景',
    thumbnailUrl: 'https://dummyimage.com/320x180/bcaaa4/ffffff&text=Room',
    description: '内置墙壁、地板与天花板的基础房间结构。',
    document: baseDocument({
      name: '简单房间',
      nodes: [
        createGroundNode(120, 80, '#908c84'),
        createGroupNode('room-structure', '房间结构', [
          createWallNode('room-walls', '房间墙体', {
            width: 120,
            depth: 80,
            height: 4,
            thickness: 0.35,
            color: '#d8d1c3',
          }),
          createBoxNodeFromFootprint('room-ceiling', '天花板', {
            footprint: [
              [-60, -40],
              [60, -40],
              [60, 40],
              [-60, 40],
            ],
            height: 0.25,
            position: vec3(0, 4, 0),
            color: '#eee9dd',
            roughness: 0.4,
          }),
        ]),
      ],
      materials: [],
      selectedNodeIds: [GROUND_NODE_ID, 'room-structure'],
      camera: {
        position: vec3(28, 18, 26),
        target: vec3(0, 1.5, 0),
        fov: 55,
        forward: vec3(-0.69, -0.44, -0.57),
      },
      groundSettings: { width: 120, depth: 80 },
    }),
  },
  {
    id: 'exhibition-hall',
    name: '展览厅场景',
    thumbnailUrl: 'https://dummyimage.com/320x180/1565c0/ffffff&text=Gallery',
    description: '包含外围墙体、展览隔断与照明的展览厅布局。',
    document: baseDocument({
      name: '展览厅',
      nodes: [
        createGroundNode(200, 140, '#cfd8dc'),
        createGroupNode('exhibition-layout', '展陈结构', [
          createWallNode('exhibition-outer-walls', '外墙', {
            width: 200,
            depth: 140,
            height: 6,
            thickness: 0.4,
            color: '#f5f5f5',
          }),
          createStraightWallNode('exhibition-partition-a', '展墙 A', {
            start: vec3(-70, 0, -40),
            end: vec3(-70, 0, 40),
            height: 4.5,
            thickness: 0.3,
            color: '#fafafa',
          }),
          createStraightWallNode('exhibition-partition-b', '展墙 B', {
            start: vec3(0, 0, -55),
            end: vec3(0, 0, 55),
            height: 4.5,
            thickness: 0.3,
            color: '#f0f0f0',
          }),
          createBoxNodeFromFootprint('exhibition-stage', '前景平台', {
            footprint: [
              [-20, -12],
              [20, -12],
              [20, 12],
              [-20, 12],
            ],
            height: 0.6,
            position: vec3(40, 0, 0),
            color: '#e0e0e0',
            roughness: 0.4,
          }),
          createLightNode('exhibition-light-a', '聚光灯 A', {
            type: 'Spot',
            position: vec3(-60, 6, -30),
            color: '#ffffff',
            intensity: 2.4,
            angle: Math.PI / 4,
            distance: 90,
          }),
          createLightNode('exhibition-light-b', '聚光灯 B', {
            type: 'Spot',
            position: vec3(0, 6.5, 0),
            color: '#ffffff',
            intensity: 2.8,
            angle: Math.PI / 3,
            distance: 110,
          }),
          createLightNode('exhibition-light-c', '聚光灯 C', {
            type: 'Spot',
            position: vec3(70, 6, 25),
            color: '#fff4e5',
            intensity: 2.1,
            angle: Math.PI / 4,
            distance: 100,
          }),
        ]),
      ],
      materials: [],
      selectedNodeIds: [GROUND_NODE_ID, 'exhibition-layout'],
      camera: {
        position: vec3(58, 28, 64),
        target: vec3(0, 3, 0),
        fov: 55,
        forward: vec3(-0.67, -0.37, -0.64),
      },
      viewportSettings: {
        showGrid: true,
        showAxes: true,
        cameraProjection: 'perspective',
        cameraControlMode: 'orbit',
      },
      skybox: {
        presetId: 'overcast',
        exposure: 0.4,
        turbidity: 8,
        rayleigh: 1.6,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.8,
        elevation: 55,
        azimuth: 180,
      },
      shadowsEnabled: true,
      groundSettings: { width: 200, depth: 140 },
    }),
  },
  {
    id: 'outdoor-grassland',
    name: '户外场景草地',
    thumbnailUrl: 'https://dummyimage.com/320x180/4caf50/ffffff&text=Grass',
    description: '宽阔草地与简单植被，适合自然户外展示。',
    document: baseDocument({
      name: '户外草地',
      nodes: [
        createGroundNode(220, 180, '#5d9951'),
        createGroupNode('grass-vegetation', '植被组', [
          createTreeGroup('tree-north', '北侧树', vec3(-70, 0, -60)),
          createTreeGroup('tree-south', '南侧树', vec3(60, 0, 50)),
          createFlowerPatch('flower-west', '花丛西侧', vec3(-30, 0, 20), '#ff8fb1'),
          createFlowerPatch('flower-east', '花丛东侧', vec3(25, 0, -15), '#ffdd67'),
        ]),
        createLightNode('sun-directional', '阳光', {
          type: 'Directional',
          position: vec3(120, 140, 80),
          color: '#fff6d5',
          intensity: 1.2,
        }),
      ],
      materials: [],
      selectedNodeIds: [GROUND_NODE_ID, 'grass-vegetation'],
      camera: {
        position: vec3(72, 30, 92),
        target: vec3(0, 2, 0),
        fov: 60,
        forward: vec3(-0.60, -0.32, -0.73),
      },
      viewportSettings: {
        showGrid: true,
        showAxes: false,
        cameraProjection: 'perspective',
        cameraControlMode: 'orbit',
      },
      skybox: {
        presetId: 'clear-day',
        exposure: 0.72,
        turbidity: 3,
        rayleigh: 1,
        mieCoefficient: 0.002,
        mieDirectionalG: 0.7,
        elevation: 35,
        azimuth: 120,
      },
      shadowsEnabled: true,
      groundSettings: { width: 220, depth: 180 },
    }),
  },
  {
    id: 'outdoor-beach',
    name: '户外场景沙滩',
    thumbnailUrl: 'https://dummyimage.com/320x180/ffcc80/4a3426&text=Beach',
    description: '带有沙滩、遮阳伞与躺椅的海滨场景。',
    document: baseDocument({
      name: '户外沙滩',
      nodes: [
        createGroundNode(240, 160, '#d9c39a'),
        createBoxNodeFromFootprint('beach-waterline', '海水边界', {
          footprint: [
            [-120, -70],
            [120, -70],
            [120, -160],
            [-120, -160],
          ],
          height: 0.4,
          position: vec3(0, -0.1, 0),
          color: '#5ec6ff',
          roughness: 0.2,
        }),
        createGroupNode('beach-furniture', '沙滩设施', [
          createUmbrellaGroup('umbrella-a', '遮阳伞 A', vec3(-40, 0, 35), '#ff867c'),
          createUmbrellaGroup('umbrella-b', '遮阳伞 B', vec3(35, 0, 55), '#ffd54f'),
          createLoungeChair('chair-a', '躺椅 A', vec3(-42, 0, 42)),
          createLoungeChair('chair-b', '躺椅 B', vec3(28, 0, 62)),
        ]),
        createLightNode('beach-sun', '午后阳光', {
          type: 'Directional',
          position: vec3(160, 130, 100),
          color: '#fff2c1',
          intensity: 1.35,
        }),
      ],
      materials: [],
      selectedNodeIds: [GROUND_NODE_ID, 'beach-furniture'],
      camera: {
        position: vec3(80, 26, 84),
        target: vec3(0, 1, 10),
        fov: 58,
        forward: vec3(-0.66, -0.28, -0.69),
      },
      viewportSettings: {
        showGrid: true,
        showAxes: false,
        cameraProjection: 'perspective',
        cameraControlMode: 'orbit',
      },
      skybox: {
        presetId: 'golden-hour',
        exposure: 0.55,
        turbidity: 5,
        rayleigh: 1.1,
        mieCoefficient: 0.0045,
        mieDirectionalG: 0.85,
        elevation: 18,
        azimuth: 210,
      },
      shadowsEnabled: true,
      groundSettings: { width: 240, depth: 160 },
    }),
  },
]
