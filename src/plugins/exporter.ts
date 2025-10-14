
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export type ExportFormat = 'OBJ' | 'PLY' | 'STL' | 'GLTF' | 'GLB'

export interface SceneExportOptions {
    format: ExportFormat
    fileName?: string
    onProgress?: (progress: number, message?: string) => void
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


function getAnimations(scene: THREE.Scene) {

    const animations: THREE.AnimationClip[] = [];

    scene.traverse(function (object) {

        animations.push(...object.animations);

    });

    return animations;

}
export function exportGLB(scene: THREE.Scene, fileName: string) {
    const animations = getAnimations(scene)
    const optimizedAnimations = []
    for ( const animation of animations ) {
        optimizedAnimations.push( animation.clone().optimize() );
    }
    const exporter = new GLTFExporter()
    exporter.parse( scene, function ( result ) {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        triggerDownload(blob, `${fileName}.glb`)
    }, () => {}, { binary: true, animations: optimizedAnimations } )
}

export function exportGLTF(scene: THREE.Scene, fileName: string) {
    const exporter = new GLTFExporter()
    const animations = getAnimations(scene)
    const optimizedAnimations = []
    for ( const animation of animations ) {
        optimizedAnimations.push( animation.clone().optimize() );
    }
    exporter.parse( scene, function ( result ) {
        const json = JSON.stringify(result, null, 2)
        const blob = new Blob([json], { type: 'model/gltf+json' })
        triggerDownload(blob, `${fileName}.gltf`)
    }, () => {}, { binary: false, animations: optimizedAnimations } )
}

export function exportOBJ(object: THREE.Object3D, fileName: string) {
    const exporter = new OBJExporter()
    const data = exporter.parse(object)
    const blob = new Blob([data], { type: 'text/plain' })
    triggerDownload(blob, `${fileName}.obj`)
}

export  function exportPLY(scene: THREE.Scene, fileName: string) {
    const exporter = new PLYExporter()
    exporter.parse(scene, function ( result ) {
        const blob = new Blob([result], { type: 'application/octet-stream' })
        triggerDownload(blob, `${fileName}.ply`)
    }, { binary: true });
}

export function exportSTL(scene: THREE.Scene, fileName: string) {
    const exporter = new STLExporter()
    const result = exporter.parse(scene, { binary: true });
    const blob = new Blob([result], { type: 'model/stl' })
    triggerDownload(blob, `${fileName}.stl`)
}
