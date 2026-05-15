import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = resolve(currentFile, '..');
const viewerRoot = resolve(scriptDir, '..');
const distRoot = resolve(viewerRoot, 'dist/build/mp-weixin');

const checkedFiles = [
  'app.js',
  'common/vendor.js',
  'pages/index/index.js',
];

const checkedAssets = ['assets'];

const forbiddenPatterns = [
  'pages/scenery/common/vendor.js',
  'pages/physics-ammo/common/vendor.js',
  'pages/physics-cannon/common/vendor.js',
  '@harmony/schema',
  'guideboardComponentDefinition',
  'clearGroundCollisionRuntimeHost',
  'syncGroundCollisionRuntimeHost',
  'ShaderMaterial',
  'Float32BufferAttribute',
  'physicsBackendBridge',
  'physicsBodySync',
  'physicsEngine',
  'physicsShapeResolvers',
  'WechatPhysicsBridge',
  'createWechatPhysicsBridge',
  'createInMemoryWechatPhysicsWorker',
  'BVHNode',
  'MeshBVH',
  'three-mesh-bvh',
  'ammojs3',
  'cannon-es',
  'polygon-clipping',
  '@msgpack/msgpack',
  'robust-predicates',
  'splaytree',
  'three-csm',
  'DRACOLoader',
  'KTX2Loader',
];

const hits = [];

for (const relativePath of checkedFiles) {
  const absolutePath = resolve(distRoot, relativePath);
  let content = '';

  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`Missing expected mp-weixin build artifact: ${absolutePath}`);
  }

  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      hits.push(`${relativePath} -> ${pattern}`);
    }
  }
}

for (const relativeDir of checkedAssets) {
  const absoluteDir = resolve(distRoot, relativeDir);
  let entries = [];

  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    continue;
  }

  for (const entry of entries) {
    const relativeName = `${relativeDir}/${entry.name}`;
    if (entry.isFile() && relativeName.includes('ammo.wasm')) {
      hits.push(relativeName);
    }
  }
}

if (hits.length > 0) {
  throw new Error(
    [
      'Main package picked up forbidden scenery/physics references:',
      ...hits.map((hit) => `- ${hit}`),
    ].join('\n'),
  );
}

console.log('[harmony-viewer] verified mp-weixin main package contains no scenery/physics chunks');
