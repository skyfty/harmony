/**
 * Slow Roads 云层着色器注入回归测试。
 *
 * 云层混合片元体必须与天空雾体在**同一次** `#include <fog_fragment>` 替换中
 * 拼接注入：该 include 被 injectSlowroadsSkyFogFragment 消费后再执行第二次
 * `.replace('#include <fog_fragment>', …)` 会静默失配，云层平面退化成与天空
 * 相同的雾渐变（任何预设都看不到云）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSlowroadsClouds, type SlowroadsCloudsHandle } from '@schema/slowroads/render/clouds'

let clouds: SlowroadsCloudsHandle | null = null

afterEach(() => {
  clouds?.dispose()
  clouds = null
})

describe('slowroads clouds shader injection', () => {
  it('appends the cloud fragment body right after the sky fog fragment', () => {
    clouds = createSlowroadsClouds(new THREE.Texture())
    const material = clouds.mesh.material as THREE.MeshBasicMaterial
    const onBeforeCompile = material.onBeforeCompile
    const parameters = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as Parameters<typeof onBeforeCompile>[0]

    onBeforeCompile(parameters, undefined as never)

    // 顶点：云层自己的雾变体必须完成注入。
    expect(parameters.vertexShader).not.toContain('#include <fog_pars_vertex>')
    expect(parameters.vertexShader).not.toContain('#include <fog_vertex>')
    expect(parameters.vertexShader).toContain('varying vec2 vUUv')

    // 片元：雾体 include 已消费，天空雾体与云体都必须在场，且云体在后。
    expect(parameters.fragmentShader).not.toContain('#include <fog_fragment>')
    const skyFogIndex = parameters.fragmentShader.indexOf('srSkyBlend')
    const cloudBodyIndex = parameters.fragmentShader.indexOf('cloudFogBlend')
    expect(skyFogIndex).toBeGreaterThanOrEqual(0)
    expect(cloudBodyIndex).toBeGreaterThan(skyFogIndex)
    expect(parameters.fragmentShader).toContain('texture2D(map, vUUv)')
    expect(parameters.fragmentShader).toContain('min(1.0, cloudFogBlend)')

    // 共享雾 uniform 已绑定（天空雾体依赖 fogNear/fogFar/fogColorA/B/C）。
    expect(parameters.uniforms.fogNear).toBeTruthy()
    expect(parameters.uniforms.fogColorA).toBeTruthy()
  })
})
