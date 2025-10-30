
import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

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
    const result = exporter.parse(scene, { binary: true }) as DataView
    // Ensure we pass a true ArrayBuffer to Blob to satisfy TS DOM typings
    const outBuffer = new ArrayBuffer(result.byteLength)
    new Uint8Array(outBuffer).set(new Uint8Array(result.buffer, result.byteOffset, result.byteLength))
    const blob = new Blob([outBuffer], { type: 'model/stl' })
    return blob;
}
