
import * as THREE from 'three'

const link = document.createElement( 'a' );

function save( blob:Blob, filename:string ) {

	if ( link.href ) {

		URL.revokeObjectURL( link.href );

	}

	link.href = URL.createObjectURL( blob );
	link.download = filename || 'data.json';
	link.dispatchEvent( new MouseEvent( 'click' ) );

}

function saveArrayBuffer( buffer:ArrayBuffer, filename:string ) {

	save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );

}

export default class Exporter {
    private format: string;
    private blob: Blob | null = null;
    private filename: string = 'model';

    constructor(format: string, filename?: string, blob?: Blob) {
        this.format = format;
        this.filename = filename || this.filename;
        this.blob = blob || null;
    }
    public async export(scene: THREE.Scene) {
        switch (this.format) {
            case 'GLTF':
                this.exportGLTF(scene);
                break;
            case 'OBJ':
                this.exportOBJ(scene);
                break;
            case 'PLY':
                this.exportPLY(scene);
                break;
            case 'STL':
                this.exportSTL(scene);
                break;
            case 'GLB':
                this.exportGLB(scene);
                break;
            default:
                throw new Error(`Unsupported export format: ${this.format}`);
        }
    }

	private getAnimations( scene: THREE.Scene ): THREE.AnimationClip[] {

		const animations: THREE.AnimationClip[] = [];

		scene.traverse( function ( object: THREE.Object3D ) {

			animations.push( ... object.animations );

		} );

		return animations;

	}

    private exportGLTF(scene: THREE.Scene) {
        // Implementation for GLTF export
    }

    private exportOBJ(scene: THREE.Scene) {
        // Implementation for OBJ export
    }

    private exportPLY(scene: THREE.Scene) {
        // Implementation for PLY export
    }

    private exportSTL(scene: THREE.Scene) {
        // Implementation for STL export
    }

    private exportGLB(scene: THREE.Scene) {

    }
}