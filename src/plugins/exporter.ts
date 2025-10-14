
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

function getAnimations(scene: THREE.Scene) {

    const animations: THREE.AnimationClip[] = [];

    scene.traverse(function (object) {

        animations.push(...object.animations);

    });

    return animations;

}
export async function exportGLB(scene: THREE.Scene) {
    const animations = getAnimations(scene)
    const optimizedAnimations = []
    for ( const animation of animations ) {
        optimizedAnimations.push( animation.clone().optimize() );
    }
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync( scene,{ binary: true, animations: optimizedAnimations });
    const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
    return blob;
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
