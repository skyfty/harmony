import * as THREE from 'three'

export function resolveGroundRuntimeObject(object: THREE.Object3D | null | undefined): THREE.Object3D | null {
	if (!object) {
		return null
	}
	const runtimeGroundObject = object.userData?.groundMesh as THREE.Object3D | undefined
	if (runtimeGroundObject) {
		return runtimeGroundObject
	}
	if (object.userData?.dynamicMeshType === 'Ground') {
		return null
	}
	return object
	}

export function resolveGroundRuntimeObjectFromMap(
	objectMap: Map<string, THREE.Object3D>,
	nodeId: string,
): THREE.Object3D | null {
	return resolveGroundRuntimeObject(objectMap.get(nodeId) ?? null)
}