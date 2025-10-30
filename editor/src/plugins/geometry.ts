import * as THREE from 'three'
export type GeometryType = "Box" | "Sphere" | "Capsule" | "Circle" | "Cylinder" | "Dodecahedron" | "Icosahedron" | "Lathe" | "Octahedron" | "Plane" | "Ring" | "Sphere" | "Torus" | "TorusKnot"

export function createGeometry(type: GeometryType):THREE.Mesh {
 let mesh: THREE.Mesh
  switch(type) {
    case 'Capsule': {
      const geometry = new THREE.CapsuleGeometry( 1, 1, 4, 8 );
      const material = new THREE.MeshStandardMaterial();
      mesh = new THREE.Mesh( geometry, material );
      mesh.name = 'Capsule';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Circle': {
      const geometry = new THREE.CircleGeometry( 1, 32, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Circle';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Cylinder': {
		  const geometry = new THREE.CylinderGeometry( 1, 1, 1, 32, 1, false, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Cylinder';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Dodecahedron': {
		  const geometry = new THREE.DodecahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Dodecahedron';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Icosahedron': {
		  const geometry = new THREE.IcosahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Icosahedron';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Octahedron': {
		  const geometry = new THREE.OctahedronGeometry( 1, 0 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Octahedron';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Plane': {
      const geometry = new THREE.PlaneGeometry( 1, 1, 1, 1 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Plane';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Ring': {
      const geometry = new THREE.RingGeometry( 0.5, 1, 32, 1, 0, Math.PI * 2 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Ring';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    case 'Sphere': {
      const geometry = new THREE.SphereGeometry( 1, 32, 16, 0, Math.PI * 2, 0, Math.PI );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Sphere';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
    default: {
      const geometry = new THREE.BoxGeometry( 1, 1, 1, 1, 1, 1 );
      mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial() );
      mesh.name = 'Box';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      break
    }
  }
    return mesh
}
