import type { ParticleRuntimeRegistryEntry } from './particleRuntime'

export type ParticleRuntimeCommand =
  | { type: 'play'; componentId: string | null; restart?: boolean }
  | { type: 'stop'; componentId: string | null; softStop?: boolean }
  | { type: 'burst'; componentId: string | null; emitterId: string | null; count?: number }

export function resolveParticleRuntimeEntry(
  registry: Record<string, ParticleRuntimeRegistryEntry> | undefined,
  componentId: string | null | undefined,
): ParticleRuntimeRegistryEntry | null {
  if (!registry) {
    return null
  }
  if (componentId && registry[componentId]) {
    return registry[componentId] ?? null
  }
  const first = Object.values(registry)[0]
  return first ?? null
}

export function applyParticleRuntimeCommand(
  registry: Record<string, ParticleRuntimeRegistryEntry> | undefined,
  command: ParticleRuntimeCommand,
): void {
  const target = resolveParticleRuntimeEntry(registry, command.componentId)
  if (!target) {
    return
  }
  if (command.type === 'play') {
    if (command.restart) {
      target.stop({ soft: false })
    }
    target.play()
    return
  }
  if (command.type === 'stop') {
    target.stop({ soft: command.softStop })
    return
  }
  target.burst(command.count, command.emitterId ?? undefined)
}
