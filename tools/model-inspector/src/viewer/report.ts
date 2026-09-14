import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { PipelineMode } from '../types'
import type { InspectionResult } from './inspect'
import { findEngineUnsupportedExtensions, type LoadedModel } from './pipeline'
import type { StageSettings } from './stage'

export type InspectionReport = {
  format: 'harmony-model-inspection-report'
  version: 1
  generatedAt: string
  pipeline: PipelineMode
  summary: {
    fileName: string
    extension: string
    sizeBytes: number
    sourceKind: 'file' | 'url'
    parsePath: LoadedModel['parsePath']
    engineSupported: boolean
    engineUnsupportedExtensions: string[]
    gltfExtensions: LoadedModel['extensions']
    notices: string[]
    bounds: InspectionResult['bounds']
  } | null
  stats: InspectionResult['stats'] | null
  nodes: InspectionResult['nodes']
  materials: InspectionResult['materials']
  textures: InspectionResult['textures']
  animations: InspectionResult['animations']
  issues: InspectionResult['issues']
  renderSettings: StageSettings
  pipelineComparison: {
    engineError: string | null
    nativeError: string | null
    engineParsePath: string | null
    nativeParsePath: string | null
  }
}

export function buildReport(input: {
  model: LoadedModel | null
  pipeline: PipelineMode
  inspection: InspectionResult | null
  stage: StageSettings
  engineError: string | null
  nativeError: string | null
  engineParsePath: string | null
  nativeParsePath: string | null
}): InspectionReport {
  const { model, inspection } = input
  return {
    format: 'harmony-model-inspection-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    pipeline: input.pipeline,
    summary: model
      ? {
          fileName: model.file.name,
          extension: model.file.extension,
          sizeBytes: model.file.bytes,
          sourceKind: model.file.sourceKind,
          parsePath: model.parsePath,
          engineSupported: model.engineSupported,
          engineUnsupportedExtensions: findEngineUnsupportedExtensions(model.extensions),
          gltfExtensions: model.extensions,
          notices: model.notices,
          bounds: inspection?.bounds ?? null,
        }
      : null,
    stats: inspection?.stats ?? null,
    nodes: inspection?.nodes ?? [],
    materials: inspection?.materials ?? [],
    textures: inspection?.textures ?? [],
    animations: inspection?.animations ?? [],
    issues: inspection?.issues ?? [],
    renderSettings: input.stage,
    pipelineComparison: {
      engineError: input.engineError,
      nativeError: input.nativeError,
      engineParsePath: input.engineParsePath,
      nativeParsePath: input.nativeParsePath,
    },
  }
}

export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(fileName: string, dataUrl: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.click()
}

export async function copyReportToClipboard(report: InspectionReport): Promise<void> {
  const text = JSON.stringify(report, null, 2)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'model'
}

export function buildReportFileName(model: LoadedModel | null): string {
  const name = model?.file.name ?? 'model'
  return `${baseName(name)}.inspection.json`
}

export function buildGlbFileName(model: LoadedModel | null): string {
  const name = model?.file.name ?? 'model.glb'
  return `${baseName(name)}.engine-normalized.glb`
}

export function buildScreenshotFileName(model: LoadedModel | null): string {
  const name = model?.file.name ?? 'model'
  return `${baseName(name)}.screenshot.png`
}

export async function exportNormalizedGlb(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[],
  fileName: string,
): Promise<void> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(root, {
    binary: true,
    animations,
    onlyVisible: false,
    includeCustomExtensions: false,
  })
  const blob = new Blob([result instanceof ArrayBuffer ? result : JSON.stringify(result)], {
    type: result instanceof ArrayBuffer ? 'model/gltf-binary' : 'model/gltf+json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
