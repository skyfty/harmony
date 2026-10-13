#!/usr/bin/env node
/**
 * Extracts slowroads' environment presets (season x time x weather) from the
 * unpacked game bundle and writes `src/core/environmentPresets.generated.ts`.
 *
 * Source: the DevMidlineGenerator chunk of the shipped slowroads app. The four
 * scene style objects (`{common:{maps:...}, morning:{clear,overcast}, day:{...},
 * evening:{...}, night:{...}}`) are located by resolving each block's bush
 * atlas filename back to its season, so minified symbol names may change
 * without breaking the extraction.
 *
 * Usage:
 *   node scripts/extract-environment-presets.mjs [--bundle <file.js>]
 *
 * Default bundle path: %TEMP%/sr/js/chunks__DevMidlineGenerator*.js (the
 * unpacked slowroads bundle used in this workspace). Download guidance:
 * fetch https://slowroads.io/ with a browser UA, read the modulepreload list
 * from `_app/immutable/entry/app.*.js` and save the DevMidlineGenerator chunk.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LAB_ROOT = resolve(HERE, '..')
const OUT_PATH = join(LAB_ROOT, 'src', 'core', 'environmentPresets.generated.ts')

const TIMES = ['morning', 'day', 'evening', 'night']
const WEATHERS = ['clear', 'overcast']

function parseArgs(argv) {
  const args = { bundle: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--bundle') args.bundle = argv[++i]
  }
  return args
}

function findDefaultBundle() {
  const dir = join(tmpdir(), 'sr', 'js')
  if (!existsSync(dir)) {
    return null
  }
  const match = readdirSync(dir).find((name) => name.startsWith('chunks__DevMidlineGenerator') && name.endsWith('.js'))
  return match ? join(dir, match) : null
}

/** Extract a balanced object literal starting at `startIndex` (must point at '{'). */
function extractBalanced(text, startIndex) {
  let depth = 0
  let quote = null
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') {
        i += 1
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIndex, i + 1)
      }
    }
  }
  throw new Error('unbalanced object literal')
}

/** Locate `{key:{...}` / `,key:{...}` inside an object literal body. */
function findObjectValue(literal, key) {
  const match = new RegExp(`[,{]${key}:(\\{)`).exec(literal)
  if (!match) {
    return null
  }
  const braceStart = match.index + match[0].length - 1
  const value = extractBalanced(literal, braceStart)
  // Delete span: include the leading comma, or (first member) the key text plus
  // one following comma.
  let deleteStart = match.index
  let deleteEnd = braceStart + value.length
  if (literal[deleteStart] !== ',') {
    deleteStart += 1
    if (literal[deleteEnd] === ',') {
      deleteEnd += 1
    }
  }
  return { value, deleteStart, deleteEnd }
}

/** Remove a `key:{...}` value (balanced) from an object literal body. */
function removeObjectValue(literal, key) {
  const found = findObjectValue(literal, key)
  if (!found) {
    return literal
  }
  return literal.slice(0, found.deleteStart) + literal.slice(found.deleteEnd)
}

/** Slice `<key>:{...}` out of an object literal body. */
function sliceObjectValue(literal, key) {
  return findObjectValue(literal, key)?.value ?? null
}

function resolveSeasonFromStyle(bundle, styleSymbol) {
  const esc = styleSymbol.replace(/[$]/g, '\\$&')
  const styleDef = new RegExp(`(?:^|[^\\w$])${esc}=\\{common:\\{maps:([\\w$]+),`).exec(bundle)
  if (!styleDef) {
    throw new Error(`style definition not found for ${styleSymbol}`)
  }
  const mapsSymbol = styleDef[1]
  const mapsEsc = mapsSymbol.replace(/[$]/g, '\\$&')
  const bushesMatch = new RegExp(`(?:^|[^\\w$])${mapsEsc}=\\{[^}]*?bushes:([\\w$]+),`).exec(bundle)
  if (!bushesMatch) {
    throw new Error(`bushes entry not found in maps ${mapsSymbol}`)
  }
  const bushesSymbol = bushesMatch[1]
  const bushesEsc = bushesSymbol.replace(/[$]/g, '\\$&')
  const urlMatch = new RegExp(`(?:^|[^\\w$])${bushesEsc}=""\\+new URL\\("(\\.\\./assets/[^"]+)"`).exec(bundle)
  if (!urlMatch) {
    throw new Error(`bush atlas url not found for ${bushesSymbol}`)
  }
  const file = urlMatch[1].split('/').pop()
  const season = ['spring', 'summer', 'autumn', 'winter'].find((name) => file.startsWith(`${name}_`))
  if (!season) {
    throw new Error(`cannot resolve season from ${file}`)
  }
  return { season, file }
}

function hex(color) {
  return `#${(color >>> 0).toString(16).padStart(6, '0').toUpperCase()}`
}

function transformPreset(raw, { season, time, weather }) {
  const lights = raw.lights
  const fog = raw.fog
  const water = raw.water
  const clouds = raw.clouds
  if (!lights || !fog || !water || !clouds) {
    throw new Error(`preset ${season}/${time}/${weather} missing core sections`)
  }
  const preset = {
    lights: {
      sun: { col: hex(lights.sun.col), intensity: lights.sun.intensity },
      ambient: { col: hex(lights.ambient.col), intensity: lights.ambient.intensity },
      fresnelFactor: lights.fresnelFactor,
      radiance: lights.radiance,
    },
    fog: {
      colA: hex(fog.colA),
      colB: hex(fog.colB),
      colC: fog.colC === undefined ? null : hex(fog.colC),
      near: fog.near,
      far: fog.far,
      hazeHeight: fog.hazeHeight ?? 0,
      hazeIntensity: fog.hazeIntensity ?? 0,
    },
    water: {
      base: hex(water.base),
      body: hex(water.body),
      highlight: hex(water.highlight),
      underwater: hex(water.underwater),
    },
    clouds: {
      hasClouds: clouds.hasClouds !== false,
      highlight: hex(clouds.highlight),
      lowlight: hex(clouds.lowlight),
      shelfHeight0: clouds.shelfHeight0,
      shelfHeight1: clouds.shelfHeight1,
      skyScale0: clouds.skyScale0,
      skyScale1: clouds.skyScale1,
      mode: clouds.mode,
    },
  }
  if (raw.stars) {
    preset.stars = {
      density: raw.stars.density,
      horizonOffset: raw.stars.horizonOffset,
      horizonScale: raw.stars.horizonScale,
      horizonOpacity: raw.stars.horizonOpacity,
    }
  }
  if (raw.snow) {
    preset.snow = { density: raw.snow.density, col: hex(raw.snow.col), speed: raw.snow.speed }
  }
  return preset
}

function emitTs(presets) {
  const lines = []
  lines.push('// GENERATED by scripts/extract-environment-presets.mjs — do not edit by hand.')
  lines.push('// Source: slowroads app bundle (DevMidlineGenerator chunk), scene style presets.')
  lines.push("import type { EnvironmentPreset, SeasonId, TimeOfDay, Weather } from './environment'")
  lines.push('')
  lines.push('export const ENVIRONMENT_PRESETS = {')
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    lines.push(`  ${season}: {`)
    for (const time of TIMES) {
      lines.push(`    ${time}: {`)
      for (const weather of WEATHERS) {
        const preset = presets[season][time][weather]
        lines.push(`      ${weather}: {`)
        lines.push(`        lights: { sun: { col: '${preset.lights.sun.col}', intensity: ${preset.lights.sun.intensity} }, ambient: { col: '${preset.lights.ambient.col}', intensity: ${preset.lights.ambient.intensity} }, fresnelFactor: ${preset.lights.fresnelFactor}, radiance: ${preset.lights.radiance} },`)
        lines.push(`        fog: { colA: '${preset.fog.colA}', colB: '${preset.fog.colB}', colC: ${preset.fog.colC === null ? 'null' : `'${preset.fog.colC}'`}, near: ${preset.fog.near}, far: ${preset.fog.far}, hazeHeight: ${preset.fog.hazeHeight}, hazeIntensity: ${preset.fog.hazeIntensity} },`)
        lines.push(`        water: { base: '${preset.water.base}', body: '${preset.water.body}', highlight: '${preset.water.highlight}', underwater: '${preset.water.underwater}' },`)
        lines.push(`        clouds: { hasClouds: ${preset.clouds.hasClouds}, highlight: '${preset.clouds.highlight}', lowlight: '${preset.clouds.lowlight}', shelfHeight0: ${preset.clouds.shelfHeight0}, shelfHeight1: ${preset.clouds.shelfHeight1}, skyScale0: ${preset.clouds.skyScale0}, skyScale1: ${preset.clouds.skyScale1}, mode: ${preset.clouds.mode} },`)
        if (preset.stars) {
          lines.push(`        stars: { density: ${preset.stars.density}, horizonOffset: ${preset.stars.horizonOffset}, horizonScale: ${preset.stars.horizonScale}, horizonOpacity: ${preset.stars.horizonOpacity} },`)
        }
        if (preset.snow) {
          lines.push(`        snow: { density: ${preset.snow.density}, col: '${preset.snow.col}', speed: ${preset.snow.speed} },`)
        }
        lines.push('      },')
      }
      lines.push('    },')
    }
    lines.push('  },')
  }
  lines.push('} as const satisfies Record<SeasonId, Record<TimeOfDay, Record<Weather, EnvironmentPreset>>>')
  lines.push('')
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const bundlePath = args.bundle ? resolve(args.bundle) : findDefaultBundle()
  if (!bundlePath || !existsSync(bundlePath)) {
    console.error('[env-extract] bundle not found. Pass --bundle <DevMidlineGenerator chunk .js>.')
    process.exit(1)
  }
  const bundle = readFileSync(bundlePath, 'utf8')

  const styleSymbols = []
  for (const match of bundle.matchAll(/([\w$]+)=\{common:\{maps:[\w$]+,/g)) {
    styleSymbols.push({ symbol: match[1], index: match.index })
  }
  if (styleSymbols.length < 4) {
    console.error(`[env-extract] expected 4 style blocks, found ${styleSymbols.length}`)
    process.exit(1)
  }

  const presets = {}
  const seenSeasons = []
  for (const entry of styleSymbols) {
    const { season, file } = resolveSeasonFromStyle(bundle, entry.symbol)
    if (presets[season]) {
      continue
    }
    const objectStart = bundle.indexOf('{common:{maps:', entry.index)
    const literal = extractBalanced(bundle, objectStart)
    const seasonPresets = {}
    for (const time of TIMES) {
      const timeLiteral = sliceObjectValue(literal, time)
      if (!timeLiteral) {
        throw new Error(`season ${season} missing time ${time}`)
      }
      seasonPresets[time] = {}
      for (const weather of WEATHERS) {
        let weatherLiteral = sliceObjectValue(timeLiteral, weather)
        if (!weatherLiteral) {
          throw new Error(`season ${season}/${time} missing weather ${weather}`)
        }
        // Shared friction/audio tables reference minified symbols; both are
        // irrelevant for the environment port.
        weatherLiteral = removeObjectValue(weatherLiteral, 'audio')
        weatherLiteral = removeObjectValue(weatherLiteral, 'friction')
        const raw = new Function(`return (${weatherLiteral})`)()
        seasonPresets[time][weather] = transformPreset(raw, { season, time, weather })
      }
    }
    presets[season] = seasonPresets
    seenSeasons.push(`${season}(${entry.symbol}, ${file})`)
  }
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    if (!presets[season]) {
      console.error(`[env-extract] missing season ${season}`)
      process.exit(1)
    }
  }

  // Invariants (official data shape): stars only at night+clear, snow only in winter.
  let presetCount = 0
  let starsCount = 0
  let snowCount = 0
  for (const season of Object.keys(presets)) {
    for (const time of TIMES) {
      for (const weather of WEATHERS) {
        const preset = presets[season][time][weather]
        presetCount += 1
        if (preset.stars) {
          starsCount += 1
          if (time !== 'night' || weather !== 'clear') {
            throw new Error(`stars outside night+clear: ${season}/${time}/${weather}`)
          }
        }
        if (preset.snow) {
          snowCount += 1
          if (season !== 'winter') {
            throw new Error(`snow outside winter: ${season}/${time}/${weather}`)
          }
        }
      }
    }
  }
  if (presetCount !== 32 || starsCount !== 4 || snowCount !== 5) {
    console.error(`[env-extract] invariant mismatch: presets=${presetCount} stars=${starsCount} snow=${snowCount}`)
    process.exit(1)
  }

  const ts = emitTs(presets)
  writeFileSync(OUT_PATH, ts, 'utf8')
  const hash = createHash('sha256').update(ts).digest('hex').slice(0, 12)
  console.log(`[env-extract] seasons: ${seenSeasons.join(', ')}`)
  console.log(`[env-extract] presets=${presetCount} stars=${starsCount} snow=${snowCount}`)
  console.log(`[env-extract] wrote ${OUT_PATH} (${ts.length} bytes, content ${hash})`)
}

main()
