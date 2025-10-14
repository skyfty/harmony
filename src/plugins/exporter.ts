
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import type { SceneNode } from '@/types/scene'
import { getRuntimeObject } from '@/stores/sceneStore'

export type ExportFormat = 'OBJ' | 'PLY' | 'STL' | 'GLTF' | 'GLB'

export interface SceneExportOptions {
    format: ExportFormat
    fileName?: string
    onProgress?: (progress: number, message?: string) => void
}

const DEFAULT_LIGHT_COLOR = 0xffffff

function sanitizeFileName(input: string): string {
    return input.replace(/[^a-zA-Z0-9-_\.]+/g, '_') || 'scene'
}

function triggerDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.style.display = 'none'
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    requestAnimationFrame(() => URL.revokeObjectURL(url))
}

    function toArrayBuffer(data: ArrayBuffer | Uint8Array<ArrayBufferLike>): ArrayBuffer {
        if (data instanceof ArrayBuffer) {
            return data
        }
        if (ArrayBuffer.isView(data)) {
            const view = data as Uint8Array
                const cloned = new ArrayBuffer(view.byteLength)
                new Uint8Array(cloned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
                return cloned
        }
    throw new Error('Unable to convert export data to ArrayBuffer')
    }

function createFallbackMaterial(color: string): THREE.Material {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.1,
        roughness: 0.6,
    })
}

function cloneRuntimeObject(nodeId: string): THREE.Object3D | null {
    const runtime = getRuntimeObject(nodeId)
    if (!runtime) {
        return null
    }
    return runtime.clone(true)
}

function createObjectForNode(node: SceneNode): THREE.Object3D {
    let object: THREE.Object3D | null = null

    if (node.geometry === 'external') {
        object = cloneRuntimeObject(node.id)
        if (!object) {
            const fallback = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createFallbackMaterial('#ff5252'))
            fallback.userData.nodeId = node.id
            object = fallback
        }
    } else {
        const material = createFallbackMaterial(node.material.color)
        switch (node.geometry) {
            case 'sphere':
                object = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), material)
                break
            case 'plane': {
                const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
                plane.rotateX(-Math.PI / 2)
                object = plane
                break
            }
            case 'box':
            default:
                object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
                break
        }
    }

    if (!object) {
        object = new THREE.Group()
    }

    object.name = node.name
    object.userData = { ...(object.userData ?? {}), nodeId: node.id }
    object.position.set(node.position.x, node.position.y, node.position.z)
    object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
    object.scale.set(node.scale.x, node.scale.y, node.scale.z)
    object.visible = node.visible ?? true

    if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
    }

    if (node.children?.length) {
        node.children.forEach((child) => {
            object!.add(createObjectForNode(child))
        })
    }

    return object
}

function collectAnimations(scene: THREE.Scene): THREE.AnimationClip[] {
    const clips: THREE.AnimationClip[] = []
    scene.traverse((child) => {
        if ((child as THREE.Object3D).animations?.length) {
            clips.push(...(child as THREE.Object3D).animations)
        }
    })
    return clips
}

function buildExportScene(nodes: SceneNode[]): THREE.Scene {
    const scene = new THREE.Scene()
    const light = new THREE.HemisphereLight(DEFAULT_LIGHT_COLOR, DEFAULT_LIGHT_COLOR, 0.35)
    scene.add(light)

    nodes.forEach((node) => {
        scene.add(createObjectForNode(node))
    })

    return scene
}

async function exportGLTF(scene: THREE.Scene, fileName: string, binary: boolean, onProgress?: SceneExportOptions['onProgress']) {
    onProgress?.(25, binary ? 'Generating GLB…' : 'Generating GLTF…')
    const exporter = new GLTFExporter()
    const animations = collectAnimations(scene)
    const result = await exporter.parseAsync(scene, {
        binary,
        animations: animations.length ? animations : undefined,
        onlyVisible: true,
    })

    if (binary) {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        triggerDownload(blob, `${fileName}.glb`)
    } else {
        const json = JSON.stringify(result, null, 2)
        const blob = new Blob([json], { type: 'model/gltf+json' })
        triggerDownload(blob, `${fileName}.gltf`)
    }
}

function exportOBJ(scene: THREE.Scene, fileName: string, onProgress?: SceneExportOptions['onProgress']) {
    onProgress?.(20, 'Generating OBJ…')
    const exporter = new OBJExporter()
    const data = exporter.parse(scene)
    const blob = new Blob([data], { type: 'text/plain' })
    triggerDownload(blob, `${fileName}.obj`)
}

function exportPLY(scene: THREE.Scene, fileName: string, onProgress?: SceneExportOptions['onProgress']) {
    onProgress?.(20, 'Generating PLY…')
    const exporter = new PLYExporter()
    const arrayBuffer = (exporter as unknown as {
        parse: (input: THREE.Object3D, options: { binary: boolean }) => ArrayBuffer | Uint8Array | null
    }).parse(scene, { binary: true })
    if (!arrayBuffer) {
        throw new Error('PLY export failed: No valid data generated')
    }
    const buffer = toArrayBuffer(arrayBuffer)
    const blob = new Blob([buffer], { type: 'application/octet-stream' })
    triggerDownload(blob, `${fileName}.ply`)
}

function exportSTL(scene: THREE.Scene, fileName: string, onProgress?: SceneExportOptions['onProgress']) {
    onProgress?.(20, 'Generating STL…')
    const exporter = new STLExporter()
    const arrayBuffer = (exporter as unknown as {
        parse: (input: THREE.Object3D, options: { binary: boolean }) => ArrayBuffer | Uint8Array | null
    }).parse(scene, { binary: true })
    if (!arrayBuffer) {
        throw new Error('STL export failed: No valid data generated')
    }
        const buffer = toArrayBuffer(arrayBuffer)
        const blob = new Blob([buffer], { type: 'model/stl' })
    triggerDownload(blob, `${fileName}.stl`)
}

export async function exportScene(scene: THREE.Scene, options: SceneExportOptions): Promise<void> {
    const { format, onProgress } = options
    const fileName = sanitizeFileName(options.fileName ?? 'scene-export')

    onProgress?.(10, 'Preparing scene…')

    try {
        switch (format) {
            case 'GLTF':
                await exportGLTF(scene, fileName, false, onProgress)
                break
            case 'GLB':
                await exportGLTF(scene, fileName, true, onProgress)
                break
            case 'OBJ':
                exportOBJ(scene, fileName, onProgress)
                break
            case 'PLY':
                exportPLY(scene, fileName, onProgress)
                break
            case 'STL':
                exportSTL(scene, fileName, onProgress)
                break
            default:
                throw new Error(`Unsupported export format: ${format}`)
        }
        onProgress?.(95, 'Export complete, preparing download…')
    } finally {
        onProgress?.(100, 'Export complete')
    }
}