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
  setOutlineTargets: (targets: THREE.Object3D[]) => void
  render: () => void
  dispose: () => void
}

type Options = {
  getRenderer: () => THREE.WebGLRenderer | null
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.Camera | null
}

function configureOutlinePassAppearance(pass: OutlinePass) {
  pass.edgeStrength = 5.5
  pass.edgeGlow = 0.8
  pass.edgeThickness = 2.75
  pass.pulsePeriod = 0
  pass.visibleEdgeColor.setHex(0xffffff)
  pass.hiddenEdgeColor.setHex(0x66d9ff)
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
  let composer: EffectComposer | null = null
  let renderPass: RenderPass | null = null
  let outlinePass: OutlinePass | null = null
  let fxaaPass: ShaderPass | null = null
  let outputPass: OutputPass | null = null
  let pendingOutlineTargets: THREE.Object3D[] | null = null

  const dispose = () => {
    if (composer) {
      composer.renderTarget1.dispose()
      composer.renderTarget2.dispose()
      composer = null
    }
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

    composer = new EffectComposer(renderer)
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(safeWidth, safeHeight)

    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    outlinePass = new OutlinePass(new THREE.Vector2(safeWidth, safeHeight), scene, camera)
    configureOutlinePassAppearance(outlinePass)
    composer.addPass(outlinePass)

    fxaaPass = new ShaderPass(FXAAShader)
    if (fxaaPass.material) {
      fxaaPass.material.toneMapped = true
    }
    composer.addPass(fxaaPass)

    outputPass = new OutputPass()
    composer.addPass(outputPass)

    updateFxaaResolution(renderer, fxaaPass, safeWidth, safeHeight)

    if (pendingOutlineTargets) {
      outlinePass.selectedObjects = pendingOutlineTargets
      pendingOutlineTargets = null
    }
  }

  const setSize = (width: number, height: number) => {
    const renderer = options.getRenderer()
    if (!renderer || !composer) {
      return
    }

    const safeWidth = Math.max(1, width)
    const safeHeight = Math.max(1, height)

    composer.setSize(safeWidth, safeHeight)
    outlinePass?.setSize(safeWidth, safeHeight)
    if (fxaaPass) {
      updateFxaaResolution(renderer, fxaaPass, safeWidth, safeHeight)
    }
  }

  const setOutlineTargets = (targets: THREE.Object3D[]) => {
    const next = targets.slice()
    if (outlinePass) {
      outlinePass.selectedObjects = next
      return
    }
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
      composer.render()
      return
    }

    renderer.render(scene, camera)
  }

  return {
    init,
    setSize,
    setOutlineTargets,
    render,
    dispose,
  }
}
