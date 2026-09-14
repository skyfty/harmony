import { PIPELINE_LABELS, type DisplayMode, type MaterialOverrides, type PipelineMode } from '../types'
import type { AnimationInfo, InspectionResult, Issue, MaterialInfo, NodeRow, TextureInfo } from '../viewer/inspect'
import { formatBytes, type LoadedModel } from '../viewer/pipeline'
import type { StageSettings } from '../viewer/stage'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function statCell(label: string, value: string): string {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function row(label: string, value: string): string {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function number(value: number): string {
  return value.toLocaleString('en-US')
}

export function renderSummary(input: {
  model: LoadedModel | null
  pipeline: PipelineMode
  inspection: InspectionResult | null
  stage: StageSettings
  errors: Record<PipelineMode, string | null>
  parsePaths: Record<PipelineMode, string | null>
}): string {
  const { model, inspection } = input
  if (!model && !inspection) {
    return `
      <p class="empty">还没有加载模型。左侧选择本地文件、粘贴 URL，或直接把模型拖进视口。</p>
      <div class="note-box">
        <strong>排查思路</strong>
        <ol>
          <li>同一个文件分别看「引擎管线」和「原生 three.js」：两边都异常 → 文件本身有问题。</li>
          <li>原生正常、引擎异常 → 引擎的解码器或导入规范化（居中落底 / alpha cutout）造成的。</li>
          <li>两边都正常但线上异常 → 关注光照、环境贴图、色调映射与阴影设置。</li>
        </ol>
      </div>
    `
  }

  const stats = inspection?.stats
  const bounds = inspection?.bounds ?? null
  const notices = model?.notices ?? []

  const parts: string[] = []
  parts.push('<div class="stats-grid">')
  parts.push(statCell('管线', PIPELINE_LABELS[input.pipeline]))
  parts.push(statCell('解析路径', input.parsePaths[input.pipeline] ?? '—'))
  if (model) {
    parts.push(statCell('文件', model.file.name))
    parts.push(statCell('格式 / 大小', `.${model.file.extension} · ${formatBytes(model.file.bytes)}`))
    parts.push(statCell('来源', model.file.sourceKind === 'file' ? '本地文件' : 'URL'))
    parts.push(statCell('引擎支持', model.engineSupported ? '是' : '否（引擎 loader 只支持 glb/fbx）'))
  }
  if (stats) {
    parts.push(statCell('网格', number(stats.meshCount)))
    parts.push(statCell('顶点', number(stats.vertices)))
    parts.push(statCell('三角面', number(stats.triangles)))
    parts.push(statCell('材质 / 贴图', `${number(stats.materialCount)} / ${number(stats.textureCount)}`))
    parts.push(statCell('骨骼 / 动画', `${number(stats.boneCount)} / ${number(stats.animationCount)}`))
    parts.push(statCell('问题', `${number(stats.issueCount)} 条`))
  }
  parts.push('</div>')

  if (bounds) {
    parts.push('<h3>尺寸</h3>')
    parts.push(
      `<div class="kv-list">
        ${row('长 × 宽 × 高', `${bounds.size[0]} × ${bounds.size[2]} × ${bounds.size[1]}`)}
        ${row('包围盒 min', bounds.min.join(', '))}
        ${row('包围盒 max', bounds.max.join(', '))}
        ${row('几何中心', bounds.center.join(', '))}
        ${row('底部 Y', String(bounds.min[1]))}
        ${row('最大边长', String(bounds.maxDimension))}
      </div>`,
    )
  }

  if (model?.extensions) {
    parts.push('<h3>glTF 扩展</h3>')
    parts.push(
      `<div class="kv-list">
        ${row('extensionsUsed', model.extensions.used.join(', ') || '—')}
        ${row('extensionsRequired', model.extensions.required.join(', ') || '—')}
        ${row('generator', model.extensions.generator ?? '—')}
      </div>`,
    )
  }

  const errorEntries = (['engine', 'native'] as PipelineMode[])
    .map((mode) => ({ mode, message: input.errors[mode] }))
    .filter((entry): entry is { mode: PipelineMode; message: string } => Boolean(entry.message))
  if (errorEntries.length) {
    parts.push('<h3>管线报错</h3>')
    for (const entry of errorEntries) {
      parts.push(
        `<div class="error-box"><strong>${escapeHtml(PIPELINE_LABELS[entry.mode])}</strong><pre>${escapeHtml(entry.message)}</pre></div>`,
      )
    }
  }

  parts.push('<h3>本次加载的行为与提示</h3>')
  if (notices.length) {
    parts.push(`<ul class="notice-list">${notices.map((notice) => `<li>${escapeHtml(notice)}</li>`).join('')}</ul>`)
  } else {
    parts.push('<p class="empty">引擎管线未改写任何材质或原点。</p>')
  }

  parts.push('<h3>当前渲染设置</h3>')
  parts.push(
    `<div class="kv-list">
      ${row('环境光', `${input.stage.ambientColor} @ ${input.stage.ambientIntensity}`)}
      ${row('方向光', `${input.stage.sunColor} @ ${input.stage.sunIntensity}（方位 ${input.stage.sunAzimuthDeg}° / 仰角 ${input.stage.sunElevationDeg}°）`)}
      ${row('阴影', input.stage.shadows ? '开启（PCFSoft，近似 CSM）' : '关闭')}
      ${row('背景', `${input.stage.background} · ${input.stage.backgroundColor}`)}
      ${row('环境强度 / 曝光', `${input.stage.environmentIntensity} / ${input.stage.exposure}`)}
      ${row('色调映射', input.stage.toneMapping)}
    </div>`,
  )

  return parts.join('')
}

export function renderNodes(nodes: NodeRow[]): string {
  if (!nodes.length) {
    return '<p class="empty">没有节点。</p>'
  }
  const items = nodes
    .map(
      (node) => `
      <li class="node-row${node.isMesh ? ' is-mesh' : ''}" style="--depth:${node.depth}" data-node-index="${node.index}">
        <button type="button" class="node-name" data-node-frame="${node.index}" title="框选该节点">${escapeHtml(node.name)}</button>
        <span class="node-type">${escapeHtml(node.type)}</span>
        <label class="node-visible"><input type="checkbox" data-node-visible="${node.index}" ${node.visible ? 'checked' : ''} /></label>
      </li>`,
    )
    .join('')
  return `<ul class="node-tree">${items}</ul>`
}

export function renderMaterials(materials: MaterialInfo[]): string {
  if (!materials.length) {
    return '<p class="empty">没有材质。</p>'
  }
  return materials
    .map(
      (material) => `
      <article class="card">
        <header>
          <strong>${escapeHtml(material.name)}</strong>
          <span class="chip subtle">${escapeHtml(material.type)}</span>
          <span class="chip subtle">${material.meshCount} 网格</span>
        </header>
        <div class="kv-list">
          ${row('side', material.sourceSide ? `${material.side}（原始 ${material.sourceSide}）` : material.side)}
          ${row('transparent / opacity', `${material.transparent} / ${material.opacity}`)}
          ${row('alphaTest / depthWrite', `${material.alphaTest} / ${material.depthWrite}`)}
          ${row('metalness / roughness', `${material.metalness} / ${material.roughness}`)}
          ${row('emissive / vertexColors', `${material.emissive} / ${material.vertexColors}`)}
          ${row('flatShading / wireframe', `${material.flatShading} / ${material.wireframe}`)}
          ${row('toneMapped', String(material.toneMapped))}
        </div>
        ${
          material.textures.length
            ? `<div class="slot-list">${material.textures
                .map(
                  (texture) =>
                    `<div class="slot"><span>${escapeHtml(texture.slot)}</span><strong>${escapeHtml(texture.dimensions)}</strong><em>${escapeHtml(texture.colorSpace)} · uv${texture.channel}${texture.loaded ? '' : ' · 未加载'}</em></div>`,
                )
                .join('')}</div>`
            : '<p class="empty">没有绑定贴图。</p>'
        }
      </article>`,
    )
    .join('')
}

export function renderTextures(textures: TextureInfo[]): string {
  if (!textures.length) {
    return '<p class="empty">没有贴图。</p>'
  }
  return `<table class="data-table">
    <thead><tr><th>槽位</th><th>尺寸</th><th>色彩空间</th><th>Wrap</th><th>Filter</th><th>UV</th><th>状态</th></tr></thead>
    <tbody>
      ${textures
        .map(
          (texture) => `<tr>
            <td>${escapeHtml(texture.slot)}<em>${escapeHtml(texture.materialName)}</em></td>
            <td>${escapeHtml(texture.dimensions)}</td>
            <td>${escapeHtml(texture.colorSpace)}</td>
            <td>${escapeHtml(texture.wrap)}</td>
            <td>${escapeHtml(texture.filter)}</td>
            <td>uv${texture.channel}</td>
            <td>${texture.loaded ? '已加载' : '<span class="bad">未加载</span>'}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`
}

export function renderIssues(issues: Issue[], counts: { error: number; warn: number; info: number }): string {
  const header = `<div class="issue-counts">
    <span class="chip" data-tone="error">${counts.error} 错误</span>
    <span class="chip" data-tone="warn">${counts.warn} 警告</span>
    <span class="chip subtle">${counts.info} 提示</span>
  </div>`
  if (!issues.length) {
    return `${header}<p class="empty">没有发现明显问题。</p>`
  }
  return `${header}${issues
    .map(
      (issue) => `<article class="card issue" data-level="${issue.level}">
        <header><strong>${escapeHtml(issue.title)}</strong><span class="chip subtle">${escapeHtml(issue.code)}</span></header>
        <p>${escapeHtml(issue.detail)}</p>
        ${
          issue.nodes.length
            ? `<div class="issue-nodes">${issue.nodes
                .slice(0, 12)
                .map(
                  (node) =>
                    `<button type="button" class="link" data-node-frame="${node.index}">${escapeHtml(node.name)}</button>`,
                )
                .join('')}${issue.nodes.length > 12 ? `<span class="empty">+${issue.nodes.length - 12}</span>` : ''}</div>`
            : ''
        }
      </article>`,
    )
    .join('')}`
}

export function renderAnimations(
  animations: AnimationInfo[],
  playback: { index: number; playing: boolean; speed: number; time: number },
): string {
  if (!animations.length) {
    return '<p class="empty">该模型没有动画片段。</p>'
  }
  const current = animations[Math.min(playback.index, animations.length - 1)]
  return `
    <label class="field"><span>动画片段</span>
      <select id="animation-clip">
        ${animations
          .map(
            (animation, index) =>
              `<option value="${index}"${index === playback.index ? ' selected' : ''}>${escapeHtml(animation.name)}（${animation.duration}s · ${animation.trackCount} 轨道）</option>`,
          )
          .join('')}
      </select>
    </label>
    <div class="playback-row">
      <button type="button" id="animation-toggle" class="secondary">${playback.playing ? '暂停' : '播放'}</button>
      <input type="range" id="animation-time" min="0" max="${Math.max(current?.duration ?? 1, 0.001)}" step="0.01" value="${playback.time}" />
      <span class="chip subtle" id="animation-time-label">${playback.time.toFixed(2)}s</span>
    </div>
    <label class="field"><span>速度</span><input type="number" id="animation-speed" min="0.05" max="5" step="0.05" value="${playback.speed}" /></label>
    <div class="kv-list">
      ${animations
        .map((animation) => row(animation.name, `${animation.duration}s · ${animation.trackCount} 轨道 · ${animation.targetNames.join(', ') || '—'}`))
        .join('')}
    </div>
  `
}

export function renderDisplaySummary(displayMode: DisplayMode, overrides: MaterialOverrides): string {
  const entries: string[] = [`显示模式：${displayMode}`]
  if (overrides.side !== 'keep') {
    entries.push(`side → ${overrides.side}`)
  }
  if (overrides.transparent !== 'keep') {
    entries.push(`transparent → ${overrides.transparent}`)
  }
  if (overrides.alphaTest !== null) {
    entries.push(`alphaTest → ${overrides.alphaTest}`)
  }
  if (overrides.flatShading !== 'keep') {
    entries.push(`flatShading → ${overrides.flatShading}`)
  }
  if (overrides.depthWrite !== 'keep') {
    entries.push(`depthWrite → ${overrides.depthWrite}`)
  }
  if (overrides.metalness !== null) {
    entries.push(`metalness → ${overrides.metalness}`)
  }
  if (overrides.roughness !== null) {
    entries.push(`roughness → ${overrides.roughness}`)
  }
  if (overrides.toneMapped !== 'keep') {
    entries.push(`toneMapped → ${overrides.toneMapped}`)
  }
  return `<p class="hint">${escapeHtml(entries.join('；'))}</p>`
}
