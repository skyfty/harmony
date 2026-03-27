// 视口后处理模块：封装了基于 three.js 的后处理链（抗锯齿、描边等）
// 此文件导出一个工厂函数 `useViewportPostprocessing`，用于初始化和管理
// 一个 EffectComposer，以及与之相关的各类 Pass（RenderPass/OutlinePass/FXAA/OutputPass）。
//
// 注：中文注释尽量解释每个函数的用途、参数含义和关键实现细节，便于阅读和维护。
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export type ViewportPostprocessing = {
  init: (width: number, height: number) => void
  setSize: (width: number, height: number) => void
  setPerformanceMode: (enabled: boolean) => void
  setOutlineTargets: (targets: THREE.Object3D[]) => void
  render: () => void
  dispose: () => void
}

type Options = {
  getRenderer: () => THREE.WebGLRenderer | null
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.Camera | null
  getPerformanceMode?: () => boolean
}

function configureOutlinePassAppearance(pass: OutlinePass) {
  // 配置 OutlinePass 的外观参数（中文说明每项含义）
  // edgeStrength: 控制描边强度，值越大描边越明显
  pass.edgeStrength = 3.2
  // edgeGlow: 控制描边的光晕/柔化效果，越大则越柔和
  pass.edgeGlow = 0.18
  // edgeThickness: 描边宽度
  pass.edgeThickness = 1.0
  // pulsePeriod: 描边脉动周期（0 表示不脉动）
  pass.pulsePeriod = 0
  // visibleEdgeColor: 未被遮挡的描边颜色（前景可见边）
  pass.visibleEdgeColor.setHex(0xd9ecff)
  // hiddenEdgeColor: 被遮挡或位于对象背后的描边颜色（被遮挡边）
  pass.hiddenEdgeColor.setHex(0x86b6d8)
  // usePatternTexture: 是否使用纹理来生成描边样式，默认关闭
  pass.usePatternTexture = false
}

function updateFxaaResolution(renderer: THREE.WebGLRenderer, fxaaPass: ShaderPass, width: number, height: number) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const pixelRatio = renderer.getPixelRatio?.() ?? 1
  const uniform = fxaaPass.uniforms?.['resolution']
  if (!uniform?.value) {
    return
  }

  const inverseWidth = 1 / (safeWidth * pixelRatio)
  const inverseHeight = 1 / (safeHeight * pixelRatio)

  const value = uniform.value as THREE.Vector2 & { x: number; y: number }
  if (typeof value.set === 'function') {
    value.set(inverseWidth, inverseHeight)
  } else {
    value.x = inverseWidth
    value.y = inverseHeight
  }
}

export function useViewportPostprocessing(options: Options): ViewportPostprocessing {
  // EffectComposer 与各种 Pass 的引用
  let composer: EffectComposer | null = null
  let renderPass: RenderPass | null = null
  let outlinePass: OutlinePass | null = null
  let fxaaPass: ShaderPass | null = null
  let outputPass: OutputPass | null = null
  // pendingOutlineTargets: 在尚未初始化 outlinePass 时临时存放的选中对象列表
  let pendingOutlineTargets: THREE.Object3D[] | null = null
  // hasOutlineTargets: 当前是否有描边目标（用于启用/禁用 outlinePass）
  let hasOutlineTargets = false
  // performanceMode: 性能模式开关（开启时会降低像素比等以提升性能）
  let performanceMode = false
  // 当前画布宽高（用于在切换性能模式时保持尺寸一致）
  let currentWidth = 1
  let currentHeight = 1

  const resolveComposerPixelRatio = (renderer: THREE.WebGLRenderer): number => {
    if (performanceMode) {
      return 1
    }
    return renderer.getPixelRatio?.() ?? 1
  }

  const updatePassState = () => {
    // 根据当前状态（是否有描边目标、是否性能模式）来启用/禁用相应的 Pass
    if (outlinePass) {
      outlinePass.enabled = hasOutlineTargets
    }
    if (fxaaPass) {
      // 在性能模式下禁用 FXAA 抗锯齿以节省开销
      fxaaPass.enabled = !performanceMode
    }
  }

  const dispose = () => {
    // 释放 composer 使用的 render targets（如果存在），并清理所有引用
    if (composer) {
      composer.renderTarget1.dispose()
      composer.renderTarget2.dispose()
      composer = null
    }
    // OutlinePass 提供了可选的 dispose 方法，调用以释放内部资源
    outlinePass?.dispose?.()
    outlinePass = null
    renderPass = null
    fxaaPass = null
    outputPass = null
  }

  const init = (width: number, height: number) => {
    const renderer = options.getRenderer()
    const scene = options.getScene()
    const camera = options.getCamera()
    if (!renderer || !scene || !camera) {
      return
    }

    dispose()

    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    currentWidth = safeWidth
    currentHeight = safeHeight
    performanceMode = Boolean(options.getPerformanceMode?.())

    composer = new EffectComposer(renderer)
    composer.setPixelRatio(resolveComposerPixelRatio(renderer))
    composer.setSize(safeWidth, safeHeight)

    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    // 创建并添加 OutlinePass（用于描边效果）
    outlinePass = new OutlinePass(new THREE.Vector2(safeWidth, safeHeight), scene, camera)
    configureOutlinePassAppearance(outlinePass)
    composer.addPass(outlinePass)

    // 创建 FXAA 抗锯齿 ShaderPass，尽量在材质上保持 toneMapped 属性
    fxaaPass = new ShaderPass(FXAAShader)
    if (fxaaPass.material) {
      // 三维渲染输出通常会经过 tone mapping，确保 FXAA 材质参与 tone mapping
      fxaaPass.material.toneMapped = true
    }
    composer.addPass(fxaaPass)

    // OutputPass：将后处理结果输出到屏幕（或 render target）
    outputPass = new OutputPass()
    composer.addPass(outputPass)

    // 根据当前渲染器与尺寸设置 FXAA 的分辨率 uniform
    updateFxaaResolution(renderer, fxaaPass, safeWidth, safeHeight)

    // 如果在 init 之前已经设置了 pendingOutlineTargets，则在此处应用
    if (pendingOutlineTargets) {
      outlinePass.selectedObjects = pendingOutlineTargets
      hasOutlineTargets = pendingOutlineTargets.length > 0
      pendingOutlineTargets = null
    }

    // 最后根据当前状态启用/禁用对应的 pass
    updatePassState()
  }

  const setSize = (width: number, height: number) => {
    const renderer = options.getRenderer()
    if (!renderer || !composer) {
      return
    }

    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)
    currentWidth = safeWidth
    currentHeight = safeHeight

    composer.setSize(safeWidth, safeHeight)
    // 更新 outlinePass 大小（如果存在）并重新计算 FXAA 分辨率
    outlinePass?.setSize(safeWidth, safeHeight)
    if (fxaaPass) {
      updateFxaaResolution(renderer, fxaaPass, safeWidth, safeHeight)
    }
    updatePassState()
  }

  const setPerformanceMode = (enabled: boolean) => {
    const next = Boolean(enabled)
    if (next === performanceMode) {
      return
    }
    performanceMode = next

    const renderer = options.getRenderer()
    if (renderer && composer) {
      // 切换像素比以调整性能和质量（性能模式下像素比固定为 1）
      composer.setPixelRatio(resolveComposerPixelRatio(renderer))
      // 重设尺寸以让 composer 内部 render targets 使用新的 pixelRatio
      composer.setSize(currentWidth, currentHeight)
      outlinePass?.setSize(currentWidth, currentHeight)
      if (fxaaPass) {
        updateFxaaResolution(renderer, fxaaPass, currentWidth, currentHeight)
      }
    }
    updatePassState()
  }

  const setOutlineTargets = (targets: THREE.Object3D[]) => {
    // 接收用户传入的描边目标数组（复制一份以避免外部更改影响内部状态）
    const next = targets.slice()
    hasOutlineTargets = next.length > 0
    if (outlinePass) {
      // 如果 outlinePass 已经存在，直接应用并更新状态
      outlinePass.selectedObjects = next
      updatePassState()
      return
    }
    // 如果尚未初始化 outlinePass，则暂存到 pendingOutlineTargets，待 init 时应用
    pendingOutlineTargets = next
  }

  const render = () => {
    const renderer = options.getRenderer()
    const scene = options.getScene()
    const camera = options.getCamera()
    if (!renderer || !scene || !camera) {
      return
    }

    if (composer) {
      // 使用 EffectComposer 渲染（会顺序执行所有添加的 pass）
      composer.render()
      return
    }

    // Fallback：如果没有 composer，则直接使用 renderer 渲染场景
    renderer.render(scene, camera)
  }

  return {
    init,
    setSize,
    setPerformanceMode,
    setOutlineTargets,
    render,
    dispose,
  }
}
