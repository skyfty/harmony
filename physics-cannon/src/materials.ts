import * as CANNON from 'cannon-es'

export type CannonContactSettings = {
  contactEquationStiffness: number
  contactEquationRelaxation: number
  frictionEquationStiffness: number
  frictionEquationRelaxation: number
}

export type CannonRigidbodyMaterialEntry = {
  material: CANNON.Material
  friction: number
  restitution: number
}

export type CannonLegacyBodyType = 'STATIC' | 'KINEMATIC' | 'DYNAMIC'

export function formatCannonRigidbodyMaterialKey(friction: number, restitution: number): string {
  return `${friction.toFixed(3)}:${restitution.toFixed(3)}`
}

export function formatCannonRigidbodyContactKey(materialA: CANNON.Material, materialB: CANNON.Material): string {
  const idA = typeof materialA.id === 'number' ? materialA.id : -1
  const idB = typeof materialB.id === 'number' ? materialB.id : -1
  return idA <= idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

export function ensureCannonContactMaterial(
  world: CANNON.World,
  materialA: CANNON.Material,
  materialB: CANNON.Material,
  friction: number,
  restitution: number,
  settings: CannonContactSettings,
  contactKeys: Set<string>,
): void {
  const key = formatCannonRigidbodyContactKey(materialA, materialB)
  if (contactKeys.has(key)) {
    return
  }
  const contactOptions = {
    friction,
    restitution,
    contactEquationStiffness: settings.contactEquationStiffness,
    contactEquationRelaxation: settings.contactEquationRelaxation,
    frictionEquationStiffness: settings.frictionEquationStiffness,
    frictionEquationRelaxation: settings.frictionEquationRelaxation,
  }
  world.addContactMaterial(new CANNON.ContactMaterial(materialA, materialB, contactOptions))
  contactKeys.add(key)
}

export function registerCannonRigidbodyMaterialContacts(
  world: CANNON.World,
  entry: CannonRigidbodyMaterialEntry,
  rigidbodyMaterialCache: Map<string, CannonRigidbodyMaterialEntry>,
  settings: CannonContactSettings,
  contactKeys: Set<string>,
): void {
  ensureCannonContactMaterial(world, entry.material, entry.material, entry.friction, entry.restitution, settings, contactKeys)
  const defaultMaterial = world.defaultMaterial
  if (defaultMaterial) {
    ensureCannonContactMaterial(world, defaultMaterial, entry.material, entry.friction, entry.restitution, settings, contactKeys)
  }
  rigidbodyMaterialCache.forEach((otherEntry) => {
    if (otherEntry.material === entry.material) {
      return
    }
    const combinedFriction = Math.sqrt(entry.friction * otherEntry.friction)
    const combinedRestitution = Math.max(entry.restitution, otherEntry.restitution)
    ensureCannonContactMaterial(
      world,
      entry.material,
      otherEntry.material,
      combinedFriction,
      combinedRestitution,
      settings,
      contactKeys,
    )
  })
}

export function ensureCannonRigidbodyMaterial({
  world,
  rigidbodyMaterialCache,
  rigidbodyContactMaterialKeys,
  friction,
  restitution,
  contactSettings,
}: {
  world: CANNON.World
  rigidbodyMaterialCache: Map<string, CannonRigidbodyMaterialEntry>
  rigidbodyContactMaterialKeys: Set<string>
  friction: number
  restitution: number
  contactSettings: CannonContactSettings
}): CANNON.Material {
  const clampedFriction = clampNumber(friction, 0, 1, 0.5)
  const clampedRestitution = clampNumber(restitution, 0, 1, 0.2)
  const key = formatCannonRigidbodyMaterialKey(clampedFriction, clampedRestitution)
  let entry = rigidbodyMaterialCache.get(key)
  if (!entry) {
    const material = new CANNON.Material(`rigidbody:${key}`)
    material.friction = clampedFriction
    material.restitution = clampedRestitution
    entry = { material, friction: clampedFriction, restitution: clampedRestitution }
    rigidbodyMaterialCache.set(key, entry)
    registerCannonRigidbodyMaterialContacts(
      world,
      entry,
      rigidbodyMaterialCache,
      contactSettings,
      rigidbodyContactMaterialKeys,
    )
  }
  return entry.material
}

export function mapCannonLegacyBodyType(type: CannonLegacyBodyType): CANNON.BodyType {
  if (type === 'STATIC') {
    return CANNON.Body.STATIC
  }
  if (type === 'KINEMATIC') {
    return CANNON.Body.KINEMATIC
  }
  return CANNON.Body.DYNAMIC
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}
