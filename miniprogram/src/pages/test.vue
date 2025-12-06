<template>
  <view class="test-page">
    <PlatformCanvas
      :canvas-id="canvasId"
      type="webgl"
      class="viewer-canvas"
      @useCanvas="handleUseCanvas"
    />
  </view>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import PlatformCanvas from '@/components/PlatformCanvas.vue';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';

const canvasId = 'test-physics-canvas';

let canvasResult: UseCanvasResult | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let animationHandle: number | null = null;
let resizeCleanup: (() => void) | null = null;

let world: CANNON.World | null = null;
let sphereBody: CANNON.Body | null = null;
let boxBody: CANNON.Body | null = null;
let sphereMesh: THREE.Mesh | null = null;
let boxMesh: THREE.Mesh | null = null;

const clock = new THREE.Clock();
const syncMeshWithBody = (mesh: THREE.Object3D, body: CANNON.Body) => {
  mesh.position.set(body.position.x, body.position.y, body.position.z);
  mesh.quaternion.set(
    body.quaternion.x,
    body.quaternion.y,
    body.quaternion.z,
    body.quaternion.w,
  );
};

const handleUseCanvas = (result: UseCanvasResult) => {
  canvasResult = result;
  initScene();
};

const initScene = async () => {
  teardownScene();
  if (!canvasResult?.canvas) {
    return;
  }

  await canvasResult.recomputeSize?.();
  const { canvas } = canvasResult;
  const pixelRatio =
    canvas?.ownerDocument?.defaultView?.devicePixelRatio ||
    uni.getSystemInfoSync?.().pixelRatio ||
    1;
  const width = canvas?.width || canvas?.clientWidth || 1;
  const height = canvas?.height || canvas?.clientHeight || 1;

  renderer = new THREE.WebGLRenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    antialias: true,
    alpha: true,
  });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f172a');

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
  camera.position.set(8, 6, 12);

  controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 2;
  controls.maxDistance = 60;
  controls.target.set(0, 2, 0);

  setupLights();
  setupMeshes();
  setupPhysics();
  registerResize();

  startRenderLoop();
};

const setupLights = () => {
  if (!scene) {
    return;
  }
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1);
  directional.castShadow = true;
  directional.position.set(10, 15, 8);
  directional.shadow.mapSize.set(2048, 2048);
  scene.add(directional);
};

const setupMeshes = () => {
  if (!scene) {
    return;
  }
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x4b5563,
    metalness: 0.1,
    roughness: 0.9,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshStandardMaterial({ color: 0x60a5fa }));
  sphereMesh.position.set(-2, 6, 0);
  sphereMesh.castShadow = true;
  scene.add(sphereMesh);

  boxMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xf97316 }));
  boxMesh.position.set(2, 9, 0);
  boxMesh.castShadow = true;
  scene.add(boxMesh);
};

const setupPhysics = () => {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const defaultMaterial = new CANNON.Material('default');
  const contactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
    friction: 0.4,
    restitution: 0.3,
  });
  world.defaultContactMaterial = contactMaterial;
  world.addContactMaterial(contactMaterial);

  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: defaultMaterial,
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  sphereBody = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(1),
    position: new CANNON.Vec3(-2, 6, 0),
    material: defaultMaterial,
    linearDamping: 0.01,
    angularDamping: 0.01,
  });
  world.addBody(sphereBody);

  boxBody = new CANNON.Body({
    mass: 5,
    shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)),
    position: new CANNON.Vec3(2, 9, 0),
    material: defaultMaterial,
    angularDamping: 0.02,
  });
  world.addBody(boxBody);
};

const startRenderLoop = () => {
  const activeRenderer = renderer;
  const activeScene = scene;
  const activeCamera = camera;

  if (!activeRenderer || !activeScene || !activeCamera) {
    return;
  }
  const step = () => {
    const delta = clock.getDelta();
    world?.step(1 / 60, delta, 5);

    if (sphereMesh && sphereBody) {
      syncMeshWithBody(sphereMesh, sphereBody);
    }

    if (boxMesh && boxBody) {
      syncMeshWithBody(boxMesh, boxBody);
    }

    controls?.update();
    activeRenderer.render(activeScene, activeCamera);
    animationHandle = (canvasResult?.requestAnimationFrame || requestAnimationFrame)(step);
  };
  animationHandle = (canvasResult?.requestAnimationFrame || requestAnimationFrame)(step);
};

const registerResize = () => {
  const handleResize = async () => {
    if (!canvasResult || !renderer || !camera) {
      return;
    }
    await canvasResult.recomputeSize?.();
    const canvas = canvasResult.canvas;
    const width = canvas?.width || canvas?.clientWidth || renderer.domElement.width;
    const height = canvas?.height || canvas?.clientHeight || renderer.domElement.height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  if (typeof uni !== 'undefined' && typeof uni.onWindowResize === 'function') {
    const uniHandler = () => handleResize();
    uni.onWindowResize(uniHandler);
    resizeCleanup = () => {
      uni.offWindowResize?.(uniHandler);
      resizeCleanup = null;
    };
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize);
    resizeCleanup = () => {
      window.removeEventListener('resize', handleResize);
      resizeCleanup = null;
    };
  }
};

const teardownScene = () => {
  if (animationHandle !== null) {
    (canvasResult?.cancelAnimationFrame || cancelAnimationFrame)?.(animationHandle);
    animationHandle = null;
  }
  resizeCleanup?.();
  resizeCleanup = null;
  controls?.dispose();
  controls = null;
  renderer?.dispose();
  renderer = null;
  scene = null;
  camera = null;
  world = null;
  sphereBody = null;
  boxBody = null;
  sphereMesh = null;
  boxMesh = null;
};

onUnmounted(() => {
  teardownScene();
  canvasResult = null;
});
</script>

<style scoped lang="scss">
.test-page {
  width: 100%;
  height: 100vh;
  background: #020617;
}

.viewer-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>

