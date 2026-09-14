import { BACKGROUND_OPTIONS, TONE_MAPPING_OPTIONS } from '../viewer/stage'
import { DISPLAY_MODES } from '../types'

function optionList(options: Array<{ id: string; label: string }>, selected?: string): string {
  return options
    .map((option) => `<option value="${option.id}"${option.id === selected ? ' selected' : ''}>${option.label}</option>`)
    .join('')
}

export const LAYOUT_HTML = `
  <div class="shell">
    <aside class="panel controls">
      <header class="panel-head">
        <div>
          <p class="eyebrow">Harmony tools</p>
          <h1>模型渲染检查</h1>
        </div>
        <span class="chip" id="status-chip" data-tone="subtle">等待加载模型</span>
      </header>

      <section class="group">
        <h2>来源</h2>
        <label class="file-picker" for="file-input">
          <input
            id="file-input"
            type="file"
            multiple
            accept=".glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.tga"
          />
          <span class="file-picker-button">选择模型文件</span>
          <span class="file-picker-copy">.glb / .fbx 单文件即可；.gltf 请连同 .bin 与贴图一起多选或拖入整个文件夹</span>
        </label>
        <div class="url-row">
          <input id="url-input" type="url" placeholder="或粘贴完整下载 URL（https://…/model.glb）" />
          <button id="url-load" class="secondary">加载</button>
        </div>
        <div class="drop-zone" id="drop-zone">
          <strong>拖拽模型到右侧视口</strong>
          <span>支持 .glb / .gltf（含附属文件）/ .fbx</span>
        </div>
      </section>

      <section class="group">
        <h2>渲染管线</h2>
        <div class="segmented" id="pipeline-switch">
          <button type="button" data-mode="engine" class="active">引擎管线</button>
          <button type="button" data-mode="native">原生 three.js</button>
        </div>
        <p class="hint" id="pipeline-hint"></p>
        <label class="switch">
          <input type="checkbox" id="split-toggle" />
          <span>并排对比（同一相机同时渲染两条管线）</span>
        </label>
        <div class="check-list">
          <label><input type="checkbox" id="post-recenter" checked /> 居中并落到底面（prepareImportedObject）</label>
          <label><input type="checkbox" id="post-frontside" /> 强制 FrontSide（对照旧引擎行为）</label>
          <label><input type="checkbox" id="post-scatter" checked /> alpha 混合转 cutout</label>
        </div>
        <p class="hint">这三项只在「引擎管线」生效；改动后会重新加载引擎管线，便于逐项定位差异来源。</p>
      </section>

      <section class="group">
        <h2>光照与环境</h2>
        <div class="field-grid">
          <label class="field"><span>环境光颜色</span><input type="color" id="ambient-color" /></label>
          <label class="field"><span>环境光强度</span><input type="number" id="ambient-intensity" min="0" max="20" step="0.05" /></label>
          <label class="field"><span>方向光颜色</span><input type="color" id="sun-color" /></label>
          <label class="field"><span>方向光强度</span><input type="number" id="sun-intensity" min="0" max="20" step="0.1" /></label>
          <label class="field"><span>方位角（°）</span><input type="number" id="sun-azimuth" min="-180" max="180" step="1" /></label>
          <label class="field"><span>仰角（°）</span><input type="number" id="sun-elevation" min="-10" max="89" step="1" /></label>
        </div>
        <label class="switch"><input type="checkbox" id="shadow-toggle" /><span>启用阴影（PCFSoft）</span></label>
        <label class="field"><span>背景</span><select id="background-mode">${optionList(BACKGROUND_OPTIONS)}</select></label>
        <div class="field-grid">
          <label class="field"><span>背景纯色</span><input type="color" id="background-color" /></label>
          <label class="field"><span>渐变顶部色</span><input type="color" id="gradient-top-color" /></label>
        </div>
        <div class="field-grid">
          <label class="field"><span>环境强度</span><input type="number" id="environment-intensity" min="0" max="10" step="0.05" /></label>
          <label class="field"><span>曝光</span><input type="number" id="exposure" min="0" max="8" step="0.05" /></label>
        </div>
        <label class="field"><span>色调映射</span><select id="tone-mapping">${optionList(TONE_MAPPING_OPTIONS)}</select></label>
        <div class="field">
          <span>环境贴图（.hdr / .exr）</span>
          <input type="file" id="hdr-input" accept=".hdr,.exr" />
        </div>
        <p class="hint">默认值与引擎一致：sRGB 输出、不启用色调映射、方向光 3.0 / 环境光 0.75。</p>
      </section>

      <section class="group">
        <h2>显示</h2>
        <label class="field"><span>显示模式</span><select id="display-mode">${optionList(DISPLAY_MODES)}</select></label>
        <div class="field-grid">
          <label class="field"><span>side</span>
            <select id="override-side">
              <option value="keep" selected>保持原样</option>
              <option value="front">FrontSide</option>
              <option value="back">BackSide</option>
              <option value="double">DoubleSide</option>
            </select>
          </label>
          <label class="field"><span>transparent</span>
            <select id="override-transparent">
              <option value="keep" selected>保持原样</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label class="field"><span>alphaTest</span><input type="number" id="override-alpha-test" placeholder="保持" min="0" max="1" step="0.05" /></label>
          <label class="field"><span>flatShading</span>
            <select id="override-flat-shading">
              <option value="keep" selected>保持原样</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label class="field"><span>depthWrite</span>
            <select id="override-depth-write">
              <option value="keep" selected>保持原样</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label class="field"><span>toneMapped</span>
            <select id="override-tone-mapped">
              <option value="keep" selected>保持原样</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label class="field"><span>metalness</span><input type="number" id="override-metalness" placeholder="保持" min="0" max="1" step="0.05" /></label>
          <label class="field"><span>roughness</span><input type="number" id="override-roughness" placeholder="保持" min="0" max="1" step="0.05" /></label>
        </div>
        <button type="button" id="override-reset" class="secondary">重置显示覆写</button>
      </section>

      <section class="group">
        <h2>辅助与视角</h2>
        <div class="check-list">
          <label><input type="checkbox" id="helper-grid" checked /> 地面网格</label>
          <label><input type="checkbox" id="helper-axes" checked /> 坐标轴</label>
          <label><input type="checkbox" id="helper-bounds" /> 选中节点包围盒</label>
          <label><input type="checkbox" id="helper-skeleton" /> 骨骼显示</label>
        </div>
        <div class="button-row" id="view-buttons">
          <button type="button" class="secondary" data-view="iso">等轴</button>
          <button type="button" class="secondary" data-view="front">正</button>
          <button type="button" class="secondary" data-view="back">后</button>
          <button type="button" class="secondary" data-view="left">左</button>
          <button type="button" class="secondary" data-view="right">右</button>
          <button type="button" class="secondary" data-view="top">顶</button>
          <button type="button" class="secondary" data-view="bottom">底</button>
          <button type="button" class="secondary" data-view="fit">重新框选</button>
        </div>
        <p class="hint">快捷键：1 等轴 / 2 正 / 3 后 / 4 左 / 5 右 / 6 顶 / 7 底，R 重新框选。</p>
      </section>

      <section class="group">
        <h2>导出</h2>
        <div class="button-row">
          <button type="button" id="export-screenshot" class="secondary" disabled>截图 PNG</button>
          <button type="button" id="export-report" class="secondary" disabled>报告 JSON</button>
          <button type="button" id="copy-report" class="secondary" disabled>复制报告</button>
          <button type="button" id="export-glb" class="secondary" disabled>规范化 GLB</button>
        </div>
        <p class="hint" id="export-hint">导出的 GLB 使用当前激活管线的模型：引擎管线即为引擎规范化后的结果。</p>
      </section>
    </aside>

    <main class="panel stage">
      <div class="stage-toolbar">
        <div class="stage-title" id="stage-title">尚未加载模型</div>
        <div class="stage-badges" id="stage-badges"></div>
      </div>
      <div class="viewport" id="viewport">
        <div class="pane-labels" id="pane-labels"></div>
        <div class="pane-overlays" id="pane-overlays"></div>
      </div>
      <div class="stage-status">
        <span class="chip subtle" id="stat-fps">-- FPS</span>
        <span class="chip subtle" id="stat-draw">draw calls —</span>
        <span class="chip subtle" id="stat-triangles">三角面 —</span>
        <span class="chip subtle" id="stat-textures">纹理 —</span>
        <span class="chip subtle" id="stat-size">尺寸 —</span>
        <span class="chip subtle" id="stat-parse">解析 —</span>
      </div>
    </main>

    <aside class="panel inspector">
      <div class="tabs" id="inspector-tabs">
        <button type="button" data-tab="summary" class="active">概要</button>
        <button type="button" data-tab="nodes">节点</button>
        <button type="button" data-tab="materials">材质</button>
        <button type="button" data-tab="textures">贴图</button>
        <button type="button" data-tab="issues">问题</button>
        <button type="button" data-tab="animations">动画</button>
      </div>
      <div class="tabs-body" id="inspector-body"></div>
    </aside>
  </div>
`

export type LayoutRefs = {
  statusChip: HTMLElement
  fileInput: HTMLInputElement
  urlInput: HTMLInputElement
  urlLoad: HTMLButtonElement
  dropZone: HTMLElement
  pipelineSwitch: HTMLElement
  pipelineHint: HTMLElement
  splitToggle: HTMLInputElement
  postRecenter: HTMLInputElement
  postFrontSide: HTMLInputElement
  postScatter: HTMLInputElement
  ambientColor: HTMLInputElement
  ambientIntensity: HTMLInputElement
  sunColor: HTMLInputElement
  sunIntensity: HTMLInputElement
  sunAzimuth: HTMLInputElement
  sunElevation: HTMLInputElement
  shadowToggle: HTMLInputElement
  backgroundMode: HTMLSelectElement
  backgroundColor: HTMLInputElement
  gradientTopColor: HTMLInputElement
  environmentIntensity: HTMLInputElement
  exposure: HTMLInputElement
  toneMapping: HTMLSelectElement
  hdrInput: HTMLInputElement
  displayMode: HTMLSelectElement
  overrideSide: HTMLSelectElement
  overrideTransparent: HTMLSelectElement
  overrideAlphaTest: HTMLInputElement
  overrideFlatShading: HTMLSelectElement
  overrideDepthWrite: HTMLSelectElement
  overrideToneMapped: HTMLSelectElement
  overrideMetalness: HTMLInputElement
  overrideRoughness: HTMLInputElement
  overrideReset: HTMLButtonElement
  helperGrid: HTMLInputElement
  helperAxes: HTMLInputElement
  helperBounds: HTMLInputElement
  helperSkeleton: HTMLInputElement
  viewButtons: HTMLElement
  exportScreenshot: HTMLButtonElement
  exportReport: HTMLButtonElement
  copyReport: HTMLButtonElement
  exportGlb: HTMLButtonElement
  exportHint: HTMLElement
  stageTitle: HTMLElement
  stageBadges: HTMLElement
  viewport: HTMLElement
  paneLabels: HTMLElement
  paneOverlays: HTMLElement
  statFps: HTMLElement
  statDraw: HTMLElement
  statTriangles: HTMLElement
  statTextures: HTMLElement
  statSize: HTMLElement
  statParse: HTMLElement
  inspectorTabs: HTMLElement
  inspectorBody: HTMLElement
}

export function queryLayout(root: Document | HTMLElement): LayoutRefs {
  const pick = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector)
    if (!element) {
      throw new Error(`缺少界面元素：${selector}`)
    }
    return element
  }

  return {
    statusChip: pick('#status-chip'),
    fileInput: pick('#file-input'),
    urlInput: pick('#url-input'),
    urlLoad: pick('#url-load'),
    dropZone: pick('#drop-zone'),
    pipelineSwitch: pick('#pipeline-switch'),
    pipelineHint: pick('#pipeline-hint'),
    splitToggle: pick('#split-toggle'),
    postRecenter: pick('#post-recenter'),
    postFrontSide: pick('#post-frontside'),
    postScatter: pick('#post-scatter'),
    ambientColor: pick('#ambient-color'),
    ambientIntensity: pick('#ambient-intensity'),
    sunColor: pick('#sun-color'),
    sunIntensity: pick('#sun-intensity'),
    sunAzimuth: pick('#sun-azimuth'),
    sunElevation: pick('#sun-elevation'),
    shadowToggle: pick('#shadow-toggle'),
    backgroundMode: pick('#background-mode'),
    backgroundColor: pick('#background-color'),
    gradientTopColor: pick('#gradient-top-color'),
    environmentIntensity: pick('#environment-intensity'),
    exposure: pick('#exposure'),
    toneMapping: pick('#tone-mapping'),
    hdrInput: pick('#hdr-input'),
    displayMode: pick('#display-mode'),
    overrideSide: pick('#override-side'),
    overrideTransparent: pick('#override-transparent'),
    overrideAlphaTest: pick('#override-alpha-test'),
    overrideFlatShading: pick('#override-flat-shading'),
    overrideDepthWrite: pick('#override-depth-write'),
    overrideToneMapped: pick('#override-tone-mapped'),
    overrideMetalness: pick('#override-metalness'),
    overrideRoughness: pick('#override-roughness'),
    overrideReset: pick('#override-reset'),
    helperGrid: pick('#helper-grid'),
    helperAxes: pick('#helper-axes'),
    helperBounds: pick('#helper-bounds'),
    helperSkeleton: pick('#helper-skeleton'),
    viewButtons: pick('#view-buttons'),
    exportScreenshot: pick('#export-screenshot'),
    exportReport: pick('#export-report'),
    copyReport: pick('#copy-report'),
    exportGlb: pick('#export-glb'),
    exportHint: pick('#export-hint'),
    stageTitle: pick('#stage-title'),
    stageBadges: pick('#stage-badges'),
    viewport: pick('#viewport'),
    paneLabels: pick('#pane-labels'),
    paneOverlays: pick('#pane-overlays'),
    statFps: pick('#stat-fps'),
    statDraw: pick('#stat-draw'),
    statTriangles: pick('#stat-triangles'),
    statTextures: pick('#stat-textures'),
    statSize: pick('#stat-size'),
    statParse: pick('#stat-parse'),
    inspectorTabs: pick('#inspector-tabs'),
    inspectorBody: pick('#inspector-body'),
  }
}
