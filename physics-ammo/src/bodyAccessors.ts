import { createAmmoTransform, createAmmoVector3, type AmmoApi, type AmmoQuaternion, type AmmoVector3 } from './ammoHelpers'

export function defineAmmoBodyAccessors(ammo: AmmoApi, body: any): void {
  const state = {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as AmmoQuaternion,
    linearVelocity: [0, 0, 0] as AmmoVector3,
    angularVelocity: [0, 0, 0] as AmmoVector3,
  }

  const readTransform = (): void => {
    const transform = body.getWorldTransform?.()
    if (!transform) {
      return
    }
    const origin = transform.getOrigin?.()
    const rotation = transform.getRotation?.()
    if (origin) {
      state.position = [origin.x?.() ?? state.position[0], origin.y?.() ?? state.position[1], origin.z?.() ?? state.position[2]]
    }
    if (rotation) {
      state.rotation = [
        rotation.x?.() ?? state.rotation[0],
        rotation.y?.() ?? state.rotation[1],
        rotation.z?.() ?? state.rotation[2],
        rotation.w?.() ?? state.rotation[3],
      ]
    }
    const lv = body.getLinearVelocity?.()
    if (lv) {
      state.linearVelocity = [lv.x?.() ?? state.linearVelocity[0], lv.y?.() ?? state.linearVelocity[1], lv.z?.() ?? state.linearVelocity[2]]
    }
    const av = body.getAngularVelocity?.()
    if (av) {
      state.angularVelocity = [av.x?.() ?? state.angularVelocity[0], av.y?.() ?? state.angularVelocity[1], av.z?.() ?? state.angularVelocity[2]]
    }
  }

  const writeTransform = (position: AmmoVector3, rotation: AmmoQuaternion): void => {
    const transform = createAmmoTransform(ammo, { position, rotation })
    body.setWorldTransform?.(transform)
    body.getMotionState?.()?.setWorldTransform?.(transform)
    ammo.destroy(transform)
    readTransform()
  }

  const positionLike: any = {}
  Object.defineProperties(positionLike, {
    x: { get: () => (readTransform(), state.position[0]), enumerable: true },
    y: { get: () => (readTransform(), state.position[1]), enumerable: true },
    z: { get: () => (readTransform(), state.position[2]), enumerable: true },
  })
  positionLike.set = (x: number, y: number, z: number): any => {
    state.position = [x, y, z]
    writeTransform(state.position, state.rotation)
    return positionLike
  }

  const quaternionLike: any = {}
  Object.defineProperties(quaternionLike, {
    x: { get: () => (readTransform(), state.rotation[0]), enumerable: true },
    y: { get: () => (readTransform(), state.rotation[1]), enumerable: true },
    z: { get: () => (readTransform(), state.rotation[2]), enumerable: true },
    w: { get: () => (readTransform(), state.rotation[3]), enumerable: true },
  })
  quaternionLike.set = (x: number, y: number, z: number, w: number): any => {
    state.rotation = [x, y, z, w]
    writeTransform(state.position, state.rotation)
    return quaternionLike
  }

  const vectorLike = (read: () => AmmoVector3, write: (next: AmmoVector3) => void): any => {
    const like: any = {}
    Object.defineProperties(like, {
      x: { get: () => read()[0], enumerable: true },
      y: { get: () => read()[1], enumerable: true },
      z: { get: () => read()[2], enumerable: true },
    })
    like.set = (x: number, y: number, z: number): any => {
      write([x, y, z])
      return like
    }
    return like
  }

  const linearVelocityLike = vectorLike(
    () => {
      readTransform()
      return state.linearVelocity
    },
    (next) => {
      state.linearVelocity = next
      const velocity = createAmmoVector3(ammo, next)
      body.setLinearVelocity?.(velocity)
      ammo.destroy(velocity)
    },
  )
  const angularVelocityLike = vectorLike(
    () => {
      readTransform()
      return state.angularVelocity
    },
    (next) => {
      state.angularVelocity = next
      const velocity = createAmmoVector3(ammo, next)
      body.setAngularVelocity?.(velocity)
      ammo.destroy(velocity)
    },
  )

  body.position = positionLike
  body.quaternion = quaternionLike
  body.velocity = linearVelocityLike
  body.angularVelocity = angularVelocityLike
  let linearDamping = 0
  let angularDamping = 0
  Object.defineProperties(body, {
    linearDamping: {
      get: () => linearDamping,
      set: (value: number) => {
        linearDamping = Math.max(0, Number(value) || 0)
        body.setDamping?.(linearDamping, angularDamping)
      },
      enumerable: true,
    },
    angularDamping: {
      get: () => angularDamping,
      set: (value: number) => {
        angularDamping = Math.max(0, Number(value) || 0)
        body.setDamping?.(linearDamping, angularDamping)
      },
      enumerable: true,
    },
  })
  body.updateMassProperties = () => {}
  body.sleep = () => body.setActivationState?.(2)
}
