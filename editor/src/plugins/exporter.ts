
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export type ExportFormat = 'OBJ' | 'PLY' | 'STL' | 'GLTF' | 'GLB'

export interface SceneExportOptions {
    format: ExportFormat
    fileName?: string
    includeTextures?: boolean
    includeAnimations?: boolean
    includeSkybox?: boolean
    includeLights?: boolean
    includeHiddenNodes?: boolean
    includeSkeletons?: boolean
    includeCameras?: boolean
    includeExtras?: boolean
    onProgress?: (progress: number, message?: string) => void
}

export interface GLBExportSettings {
    includeAnimations?: boolean
    onlyVisible?: boolean
    includeCustomExtensions?: boolean
}

type RemovedSceneObject = {
    parent: THREE.Object3D
    object: THREE.Object3D
    index: number
}

const EDITOR_HELPER_TYPES = new Set<string>([
    'GridHelper',
    'AxesHelper',
    'Box3Helper',
    'PointLightHelper',
    'SpotLightHelper',
    'DirectionalLightHelper',
    'RectAreaLightHelper',
    'HemisphereLightHelper',
    'TransformControls',
    'TransformControlsGizmo',
    'TransformControlsPlane',
])

const EDITOR_HELPER_NAMES = new Set<string>([
    'DragPreview',
    'GridHighlight',
])

const LIGHT_HELPER_NAME_SUFFIX = 'LightHelper'

function getAnimations(scene: THREE.Scene) {

    const animations: THREE.AnimationClip[] = [];

    scene.traverse(function (object) {

        animations.push(...object.animations);

    });

    return animations;

}

function shouldExcludeFromGLTF(object: THREE.Object3D) {
    if (!object.parent) {
        return false
    }

    const name = object.name ?? ''
    if (name && (EDITOR_HELPER_NAMES.has(name) || name.endsWith(LIGHT_HELPER_NAME_SUFFIX))) {
        return true
    }

    if (EDITOR_HELPER_TYPES.has(object.type)) {
        return true
    }

    return false
}

function collectEditorHelpers(root: THREE.Object3D) {
    const helpers: THREE.Object3D[] = []
    const stack: THREE.Object3D[] = [...root.children]

    while (stack.length > 0) {
        const current = stack.pop()
        if (!current) {
            continue
        }
        if (shouldExcludeFromGLTF(current)) {
            helpers.push(current)
            continue
        }

        for (const child of current.children) {
            stack.push(child)
        }
    }

    return helpers
}

function removeEditorHelpers(scene: THREE.Scene) {
    const helpers = collectEditorHelpers(scene)
    const removed: RemovedSceneObject[] = []

    for (const helper of helpers) {
        const parent = helper.parent
        if (!parent) {
            continue
        }

        const index = parent.children.indexOf(helper)
        if (index === -1) {
            continue
        }

        parent.remove(helper)
        removed.push({ parent, object: helper, index })
    }

    return removed
}

function restoreRemovedObjects(removed: RemovedSceneObject[]) {
    for (const { parent, object, index } of removed) {
        parent.add(object)

        if (index >= 0 && index < parent.children.length - 1) {
            const currentIndex = parent.children.indexOf(object)
            if (currentIndex > -1 && currentIndex !== index) {
                parent.children.splice(currentIndex, 1)
                const targetIndex = Math.min(index, parent.children.length)
                parent.children.splice(targetIndex, 0, object)
            }
        }
    }
}

export async function exportGLB(scene: THREE.Scene, settings?: GLBExportSettings) {
    const includeAnimations = settings?.includeAnimations !== false
    const animations = includeAnimations ? getAnimations(scene) : []
    const optimizedAnimations = []
    if (includeAnimations) {
        for ( const animation of animations ) {
            optimizedAnimations.push( animation.clone().optimize() );
        }
    }
    const exporter = new GLTFExporter()
    const removedHelpers = removeEditorHelpers(scene)
    try {
        const result = await exporter.parseAsync( scene,{
            binary: true,
            animations: optimizedAnimations,
            onlyVisible: settings?.onlyVisible ?? true,
            includeCustomExtensions: settings?.includeCustomExtensions ?? true,
        });
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        return blob;
    } finally {
        restoreRemovedObjects(removedHelpers)
    }
}

export async function exportGLTF(scene: THREE.Scene) {
    const exporter = new GLTFExporter()
    const animations = getAnimations(scene)
    const optimizedAnimations = []
    for ( const animation of animations ) {
        optimizedAnimations.push( animation.clone().optimize() );
    }
    const result = await exporter.parseAsync( scene, { binary: false, animations: optimizedAnimations } );
    const json = JSON.stringify(result, null, 2)
    const blob = new Blob([json], { type: 'model/gltf+json' })
    return blob;
}

export function exportOBJ(object: THREE.Object3D) {
    const exporter = new OBJExporter()
    const data = exporter.parse(object)
    const blob = new Blob([data], { type: 'text/plain' })
    return blob;
}

export  function exportPLY(scene: THREE.Scene) {
    const exporter = new PLYExporter()
    const result = exporter.parse(scene, () =>{}, { binary: true }) as ArrayBuffer ;
    const blob = new Blob([result], { type: 'application/octet-stream' })
    return blob;
}

export function exportSTL(scene: THREE.Scene) {
    const exporter = new STLExporter()
    const result = exporter.parse(scene, { binary: true });
    const blob = new Blob([result], { type: 'model/stl' })
    return blob;
}
