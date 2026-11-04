import { describe, expect, it } from 'vitest'
import { componentManager } from '@schema/components'

describe('component Agent profiles', () => {
  it('classifies every registered component exactly once', () => {
    const definitions = componentManager.listDefinitions()
    const profiles = componentManager.listAgentProfiles()
    expect(definitions.length).toBeGreaterThan(20)
    expect(profiles).toHaveLength(definitions.length)
    expect(new Set(profiles.map((profile) => profile.type)).size).toBe(profiles.length)
    profiles.forEach((profile) => {
      expect(['generic', 'domain', 'readonly']).toContain(profile.editMode)
      if (profile.editMode === 'domain') {
        expect(profile.domain).toBeTruthy()
        expect(profile.tool).toMatch(/^harmony_.+_edit$/)
        expect(profile.actions).toContain('patch_component')
      }
    })
  })

  it('routes complex component families through their domain tools', () => {
    expect(componentManager.getAgentProfile('behavior')).toMatchObject({
      editMode: 'domain',
      domain: 'behavior',
      tool: 'harmony_behavior_edit',
      protectedFields: expect.arrayContaining(['behaviors']),
    })
    expect(componentManager.getAgentProfile('guideRoute')).toMatchObject({
      editMode: 'domain',
      domain: 'guideRoute',
      tool: 'harmony_guide_route_edit',
    })
    expect(componentManager.getAgentProfile('terrainFlattening')).toMatchObject({
      editMode: 'domain',
      domain: 'terrain',
      tool: 'harmony_terrain_edit',
      actions: expect.arrayContaining([
        'runtime_stats',
        'analyze_transition',
        'fit_transition',
        'patch_component',
      ]),
    })
    expect(componentManager.getAgentProfile('vehicle')).toMatchObject({
      editMode: 'domain',
      domain: 'actor',
      tool: 'harmony_actor_edit',
    })
  })
})
