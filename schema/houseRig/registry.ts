import { basicNamingHouseRigScript } from './scripts/basic-naming'
import {
  currentTenPartHouseRigScript,
  currentTenPartHouseRigScriptV1_0_1,
  currentTenPartHouseRigScriptV1_0_2,
} from './scripts/current-ten-part-house'
import type { HouseRigScript } from './types'

const scripts = new Map<string, HouseRigScript>()

export function houseRigScriptVersionKey(id: string, version: string): string {
  return `${id}@${version}`
}

export function registerHouseRigScript(script: HouseRigScript): void {
  const id = script.id.trim()
  const version = script.version.trim()
  if (!id || !version) {
    throw new Error('House Rig scripts require a non-empty id and version')
  }
  const key = houseRigScriptVersionKey(id, version)
  if (scripts.has(key)) {
    throw new Error(`Duplicate House Rig script registration: ${key}`)
  }
  scripts.set(key, script)
}

registerHouseRigScript(basicNamingHouseRigScript)
registerHouseRigScript(currentTenPartHouseRigScript)
registerHouseRigScript(currentTenPartHouseRigScriptV1_0_1)
registerHouseRigScript(currentTenPartHouseRigScriptV1_0_2)

export function getHouseRigScript(id: string, version: string): HouseRigScript | null {
  return scripts.get(houseRigScriptVersionKey(id, version)) ?? null
}

export function listHouseRigScripts(): HouseRigScript[] {
  return Array.from(scripts.values()).sort((a, b) => {
    if (a.id !== b.id) {
      return a.id.localeCompare(b.id)
    }
    return b.version.localeCompare(a.version, undefined, { numeric: true })
  })
}

export function getLatestHouseRigScript(id: string): HouseRigScript | null {
  const candidates = listHouseRigScripts().filter((script) => script.id === id)
  return candidates[0] ?? null
}
