<script setup lang="ts">
import { useSceneStore } from '@/stores/sceneStore'
import * as THREE from 'three'

import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from '@/plugins/loader'
import { useFileDialog } from '@vueuse/core'
import { useUiStore } from '@/stores/uiStore'

const sceneStore = useSceneStore()
const uiStore = useUiStore()

function prepareImportedObject(object: THREE.Object3D) {
  object.removeFromParent()

  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    child.matrixAutoUpdate = true
  })

  object.updateMatrixWorld(true)

  const boundingBox = new THREE.Box3().setFromObject(object)
  if (!boundingBox.isEmpty()) {
    const center = boundingBox.getCenter(new THREE.Vector3())
    const minY = boundingBox.min.y

    object.position.sub(center)
    object.position.y -= (minY - center.y)
    object.updateMatrixWorld(true)
  }
}

function addImportedObjectToScene(object: THREE.Object3D) {
  prepareImportedObject(object)

  sceneStore.addSceneNode({
    object,
    name: object.name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  })
}

function handleMenuImport() {
  const loaderFile = new Loader()

  loaderFile.$on('loaded', (object: LoaderLoadedPayload) => {
    if (object) {
      const imported = object as THREE.Object3D
      console.log('Loaded object:', imported)
      addImportedObjectToScene(imported)
      uiStore.updateLoadingOverlay({
        message: `${imported.name ?? '资源'}导入完成`,
        progress: 100,
      })
      uiStore.updateLoadingProgress(100)
    } else {
      console.error('Failed to load object.')
      uiStore.updateLoadingOverlay({
        message: '导入失败，请重试',
        closable: true,
        autoClose: false,
      })
    }
  })

  loaderFile.$on('progress', (payload: LoaderProgressPayload) => {
    const percent = (payload.loaded / payload.total) * 100
    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      message: `正在导入：${payload.filename}`,
    })
    uiStore.updateLoadingProgress(percent)
    console.log(`Loading ${payload.filename}: ${percent.toFixed(2)}%`)
  })

  const { open: openFileDialog, onChange: onFileChange } = useFileDialog()

  onFileChange((files: FileList | File[] | null) => {
    if (!files || (files instanceof FileList && files.length === 0) || (Array.isArray(files) && files.length === 0)) {
      uiStore.hideLoadingOverlay(true)
      return
    }

    const fileArray = Array.isArray(files) ? files : Array.from(files)
    uiStore.startIndeterminateLoading({
      title: '导入资源',
      message: '正在准备文件…',
      closable: true,
    })
    loaderFile.loadFiles(fileArray)
  })

  openFileDialog()
}

function handleAddNode(geometry:string) {
  let mesh: THREE.Mesh
  switch(geometry) {
    case 'Capsule': {
      const geometry = new THREE.CapsuleGeometry( 1, 1, 4, 8, 1 );
      const material = new THREE.MeshStandardMaterial();
      mesh = new THREE.Mesh( geometry, material );
      mesh.name = 'Capsule';
      break
    }
    case 'Circle': {
      const geometry = new THREE.CircleGeometry( 1, 32, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Circle';
      break
    }
    case 'Cylinder': {
		  const geometry = new THREE.CylinderGeometry( 1, 1, 1, 32, 1, false, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Cylinder';
      break
    }
    case 'Dodecahedron': {
		  const geometry = new THREE.DodecahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Dodecahedron';
      break
    }
    case 'Icosahedron': {
		  const geometry = new THREE.IcosahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Icosahedron';
      break
    }
    case 'Lathe': {
      const points = [];
      for ( let i = 0; i < 10; i ++ ) {
        points.push( new THREE.Vector2( Math.sin( i * 0.2 ) * 1 + 1, ( i - 5 ) * 0.2 ) );
      }
      const geometry = new THREE.LatheGeometry( points, 32 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Lathe';
      break
    }
    case 'Octahedron': {
		  const geometry = new THREE.OctahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Octahedron';
      break
    }
    case 'Plane': {
      const geometry = new THREE.PlaneGeometry( 1, 1, 1, 1 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Plane';
      break
    }
    case 'Ring': {
      const geometry = new THREE.RingGeometry( 0.5, 1, 32, 1, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Ring';
      break
    }
    case 'Sphere': {
      const geometry = new THREE.SphereGeometry( 1, 32, 16, 0, Math.PI * 2, 0, Math.PI );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Sphere';
      break
    }
    default: {
      const geometry = new THREE.BoxGeometry( 1, 1, 1, 1, 1, 1 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Box';
      break
    }
  }
  sceneStore.addSceneNode({
    object: mesh,
    name: mesh.name,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  })
}

</script>
<template>
<v-menu>
    <template #activator="{ props }">
    <v-btn
        icon="mdi-plus"
        variant="text"
        density="compact"
        v-bind="props"
    />
    </template>
  <v-list class="add-menu-list">
      <v-list-item
          title="Box"
          @click="handleAddNode('Box')"
      />
      <v-list-item
          title="Capsule"
          @click="handleAddNode('Capsule')"
      />
      <v-list-item
          title="Circle"
          @click="handleAddNode('Circle')"
      />
      <v-list-item
          title="Cylinder"
          @click="handleAddNode('Cylinder')"
      />
      <v-list-item
          title="Dodecahedron"
          @click="handleAddNode('Dodecahedron')"
      />
      <v-list-item
          title="Icosahedron"
          @click="handleAddNode('Icosahedron')"
      />
      <v-list-item
          title="Lathe"
          @click="handleAddNode('Lathe')"
      />
      <v-list-item
          title="Octahedron"
          @click="handleAddNode('Octahedron')"
      />
      <v-list-item
          title="Plane"
          @click="handleAddNode('Plane')"
      />
      <v-list-item
          title="Ring"
          @click="handleAddNode('Ring')"
      />
      <v-list-item
          title="Sphere"
          @click="handleAddNode('Sphere')"
      />
      <v-list-item
          title="Sprite"
          @click="handleAddNode('Sprite')"
      />
  <v-divider class="add-menu-divider" />

      <v-list-item
          title="Import"
          @click="handleMenuImport()"
      />
    </v-list>
</v-menu>
</template>

<style scoped>

.add-menu-list {
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.add-menu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
  transition: background-color 160ms ease;
}

.add-menu-list :deep(.v-list-item:hover) {
  background-color: rgba(255, 255, 255, 0.08);
}

.add-menu-divider {
  align-self: stretch;
  margin: 4px 0;
  opacity: 0.2;
}

.v-toolbar .v-toolbar__content .v-btn {
    height: 20px;
    padding: 0 12px 0 12px;
    min-width: 20px;
    font-size: 12px;
    margin-left: 3px;
}

</style>