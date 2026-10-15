import * as THREE from 'three'

/**
 * 景观材质着色器审计快照。
 *
 * 迁移端的景观材质是 built-in Lambert + onBeforeCompile 注入（不是 ShaderMaterial），
 * 编译后的 uniform 表无法从材质对象直接遍历。这里在注入完成时把「最终 shader 源码 +
 * JS uniform 表键名」记到材质 userData，供启动自检做 uniform 覆盖审计
 * （着色器里声明的每个 uniform 必须在 JS 表里 ——「地面过暗」就是这类静默故障）
 * 与树卡变色源码断言（lab 的同名技能移植）。
 */

const AUDIT_KEY = '__slowroadsShaderAudit'

export interface SlowroadsShaderAudit {
  name: string
  vertexShader: string
  fragmentShader: string
  uniformKeys: string[]
}

export function recordSlowroadsShaderAudit(
  material: THREE.Material,
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> },
): void {
  const audit: SlowroadsShaderAudit = {
    name: material.name || material.type,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    uniformKeys: Object.keys(shader.uniforms),
  }
  ;(material.userData as Record<string, unknown>)[AUDIT_KEY] = audit
}

/** 从场景根收集所有已注入材质的审计快照（按名称去重）。 */
export function collectSlowroadsShaderAudits(root: THREE.Object3D | null): SlowroadsShaderAudit[] {
  if (!root) {
    return []
  }
  const seen = new Map<string, SlowroadsShaderAudit>()
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) {
      return
    }
    const entries = Array.isArray(material) ? material : [material]
    for (const entry of entries) {
      const audit = (entry?.userData as Record<string, unknown> | undefined)?.[AUDIT_KEY] as SlowroadsShaderAudit | undefined
      if (audit && !seen.has(audit.name)) {
        seen.set(audit.name, audit)
      }
    }
  })
  return Array.from(seen.values())
}
