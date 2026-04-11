declare module 'meshwalk' {
  import type { Object3D, Vector3 } from 'three'

  export class World {
    constructor(options?: { fps?: number; stepsPerFrame?: number })
    add(object: Octree | CharacterController): void
    remove(object: Octree | CharacterController): void
    fixedUpdate(): void
    step(stepDeltaTime: number): void
  }

  export class Octree {
    addGraphNode(object: Object3D): void
  }

  export class CharacterController {
    constructor(object3d: Object3D, radius: number)
    object: Object3D
    radius: number
    position: Vector3
    movementSpeed: number
    direction: number
    isRunning: boolean
    isGrounded: boolean
    isOnSlope: boolean
    groundHeight: number
    groundNormal: Vector3
    maxSlopeGradient: number
    teleport(x: number, y: number, z: number): void
    jump(): void
  }
}
