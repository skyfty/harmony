import { describe, expect, it } from 'vitest'
import {
  HARMONY_AGENT_OPERATING_POLICY,
  HARMONY_AGENT_OPERATION_NAMES,
  HARMONY_AGENT_TOOLS,
} from '@schema/editorAgentProtocol'

describe('Harmony Agent operating policy', () => {
  it('requires semantic MCP usage before UI or persistence bypasses', () => {
    expect(HARMONY_AGENT_OPERATING_POLICY).toContain('MCP semantic tools first')
    expect(HARMONY_AGENT_OPERATING_POLICY).toContain('mouse or coordinate automation')
    expect(HARMONY_AGENT_OPERATING_POLICY).toContain('direct scene-file edits')
    expect(HARMONY_AGENT_OPERATING_POLICY).toContain('first implement or extend')
    expect(HARMONY_AGENT_OPERATING_POLICY).toContain('read back changed data')
  })

  it('publishes camera and viewport-tool control tools', () => {
    expect(HARMONY_AGENT_TOOLS.camera).toBe('harmony_camera_control')
    expect(HARMONY_AGENT_TOOLS.tool).toBe('harmony_tool_control')
    expect(HARMONY_AGENT_OPERATION_NAMES).toContain('camera.set')
    expect(HARMONY_AGENT_OPERATION_NAMES).toContain('tool.set_active')
  })
})
