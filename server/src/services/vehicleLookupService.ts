import { VehicleModel } from '@/models/Vehicle'

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export async function loadVehicleNameMapByIdentifier(identifiers: string[]): Promise<Map<string, string>> {
  const normalizedIdentifiers = Array.from(new Set(identifiers.map((item) => normalizeText(item)).filter(Boolean)))
  if (!normalizedIdentifiers.length) {
    return new Map()
  }

  const rows = await VehicleModel.find(
    { identifier: { $in: normalizedIdentifiers } },
    { _id: 0, identifier: 1, name: 1 },
  )
    .lean()
    .exec()

  const map = new Map<string, string>()
  for (const row of rows) {
    const identifier = normalizeText((row as { identifier?: string }).identifier)
    const name = normalizeText((row as { name?: string }).name)
    if (!identifier || !name) {
      continue
    }
    map.set(identifier, name)
  }

  return map
}