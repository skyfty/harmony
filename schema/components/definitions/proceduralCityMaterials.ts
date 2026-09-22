/**
 * The WebGL material half of the procedural city: style themes, generated facade
 * textures, the wall material and the solid-style outline material.
 *
 * These were extracted verbatim from `proceduralCityComponent.ts` so a second
 * consumer ( the city-lab sandbox, and any future generator ) can dress its own
 * geometry in the exact same materials without importing the component registry.
 * The behavior is unchanged — this module only moves code.
 */

import * as THREE from 'three'
import { createCanvas } from '../../canvas'

export type ProceduralCityStyle = 'office' | 'bright' | 'classic' | 'warm' | 'cool' | 'solid' | 'grid'

export const PROCEDURAL_CITY_SOLID_DEFAULT_COLOR = '#9aa7b0'

const PROCEDURAL_CITY_FACADE_SOURCE_WIDTH = 128
const PROCEDURAL_CITY_FACADE_SOURCE_HEIGHT = 256
const PROCEDURAL_CITY_FACADE_LOW_QUALITY_WIDTH = 64
const PROCEDURAL_CITY_FACADE_LOW_QUALITY_HEIGHT = 128
const PROCEDURAL_CITY_SOLID_OUTLINE_COLOR = '#3a444f'
const PROCEDURAL_CITY_SOLID_OUTLINE_PIXELS = 1.25
const PROCEDURAL_CITY_SOLID_OUTLINE_NEAR_OPACITY = 0.18
const PROCEDURAL_CITY_SOLID_OUTLINE_FAR_OPACITY = 0.36
const PROCEDURAL_CITY_SOLID_OUTLINE_NEAR_DISTANCE = 60
const PROCEDURAL_CITY_SOLID_OUTLINE_FAR_DISTANCE = 320
const PROCEDURAL_CITY_SOLID_LIGHT_DIRECTION = new THREE.Vector3(0.45, 0.82, 0.35).normalize()
const PROCEDURAL_CITY_SOLID_LIGHT_AMBIENT = 0.7
const PROCEDURAL_CITY_SOLID_LIGHT_DIFFUSE = 0.3

export type ProceduralCityStyleTheme = {
  parcelPalette: string[]
  wallShades: string[]
  frameShade: string
  windowLit: string[]
  windowDark: string[]
  vertexBottomShade: number
  vertexTopShade: number
  floorBandAlpha: number
  shadowAlpha: number
  litChance: number
  alternateFloorBands: boolean
  bandTint: number
  windowGap: number
}

const PROCEDURAL_CITY_STYLE_THEMES: Record<ProceduralCityStyle, ProceduralCityStyleTheme> = {
  office: {
    parcelPalette: ['#f7f7f7', '#f4f4f4', '#f8f8f8', '#f1f1f1', '#f6f6f6', '#f3f3f3'],
    wallShades: ['#ffffff', '#f0f0f0', '#e4e4e4', '#d8d8d8'],
    frameShade: '#dcdcdc',
    windowLit: ['#f4f4f4', '#ededed', '#e6e6e6', '#f7f7f7'],
    windowDark: ['#d6d6d6', '#cbcbcb', '#c0c0c0', '#b4b4b4'],
    vertexBottomShade: 0.19,
    vertexTopShade: 1,
    floorBandAlpha: 0.0,
    shadowAlpha: 0.0,
    litChance: 0.0,
    alternateFloorBands: true,
    bandTint: 0.0,
    windowGap: 0.02,
  },
  bright: {
    parcelPalette: ['#dcd9cf', '#d5dde2', '#e1d7c7', '#d7e0e4', '#e0d0c8', '#d3dfdb'],
    wallShades: ['#88929c', '#95a0a8', '#a3adb4', '#b0b8be'],
    frameShade: '#56606a',
    windowLit: ['#f7fafc', '#fff6d4', '#eef7ff', '#f9ebbd'],
    windowDark: ['#66717b', '#727d86', '#7d8790', '#88929b'],
    vertexBottomShade: 0.7,
    vertexTopShade: 1,
    floorBandAlpha: 0.12,
    shadowAlpha: 0.08,
    litChance: 0.24,
    alternateFloorBands: false,
    bandTint: 0.03,
    windowGap: 0.2,
  },
  classic: {
    parcelPalette: ['#cfc8bc', '#bec7cd', '#d3c5b4', '#c6d0d4', '#d1c0b5', '#c1cdca'],
    wallShades: ['#7d8790', '#89939b', '#949ea6', '#a1aab1'],
    frameShade: '#4f5861',
    windowLit: ['#f0f4f7', '#fcefb8', '#e4eff9', '#f4e4a8'],
    windowDark: ['#5e6871', '#6b747d', '#768088', '#818a92'],
    vertexBottomShade: 0.62,
    vertexTopShade: 0.98,
    floorBandAlpha: 0.1,
    shadowAlpha: 0.1,
    litChance: 0.3,
    alternateFloorBands: false,
    bandTint: 0.025,
    windowGap: 0.2,
  },
  warm: {
    parcelPalette: ['#dfd2c0', '#d9c7b1', '#e4d7c6', '#d8cec1', '#e1cdbb', '#d2d4cd'],
    wallShades: ['#8e867c', '#9a9185', '#a69d92', '#b3a99d'],
    frameShade: '#665a50',
    windowLit: ['#fff4dc', '#fce4b8', '#fff1c6', '#fde8ad'],
    windowDark: ['#786d61', '#85796d', '#918478', '#9d8f83'],
    vertexBottomShade: 0.66,
    vertexTopShade: 0.98,
    floorBandAlpha: 0.12,
    shadowAlpha: 0.08,
    litChance: 0.28,
    alternateFloorBands: false,
    bandTint: 0.025,
    windowGap: 0.2,
  },
  cool: {
    parcelPalette: ['#d8dee6', '#ced8df', '#e0e6eb', '#d3dce3', '#dee4ea', '#cfd8d6'],
    wallShades: ['#87939d', '#95a0aa', '#a1adb6', '#aeb8c1'],
    frameShade: '#52606a',
    windowLit: ['#eef7ff', '#f9fbfd', '#dceeff', '#f2f7fb'],
    windowDark: ['#67727c', '#73808a', '#7f8a94', '#8b96a0'],
    vertexBottomShade: 0.68,
    vertexTopShade: 1,
    floorBandAlpha: 0.11,
    shadowAlpha: 0.07,
    litChance: 0.26,
    alternateFloorBands: false,
    bandTint: 0.03,
    windowGap: 0.2,
  },
  solid: {
    parcelPalette: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    wallShades: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    frameShade: PROCEDURAL_CITY_SOLID_DEFAULT_COLOR,
    windowLit: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    windowDark: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    vertexBottomShade: 1,
    vertexTopShade: 1,
    floorBandAlpha: 0,
    shadowAlpha: 0,
    litChance: 0,
    alternateFloorBands: false,
    bandTint: 0,
    windowGap: 0,
  },
  grid: {
    parcelPalette: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    wallShades: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    frameShade: PROCEDURAL_CITY_SOLID_DEFAULT_COLOR,
    windowLit: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    windowDark: [PROCEDURAL_CITY_SOLID_DEFAULT_COLOR],
    vertexBottomShade: 1,
    vertexTopShade: 1,
    floorBandAlpha: 0,
    shadowAlpha: 0,
    litChance: 0,
    alternateFloorBands: false,
    bandTint: 0,
    windowGap: 0,
  },
}

export function resolveProceduralCityStyle(style: unknown): ProceduralCityStyle {
  if (style === 'office' || style === 'bright' || style === 'classic' || style === 'warm' || style === 'cool' || style === 'solid' || style === 'grid') {
    return style as ProceduralCityStyle
  }
  return 'bright'
}

export function getProceduralCityStyleTheme(style: unknown): ProceduralCityStyleTheme {
  return PROCEDURAL_CITY_STYLE_THEMES[resolveProceduralCityStyle(style)]
}

function configureCityTexture(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.anisotropy = 1
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  return texture
}

const facadeTextureByStyle = new Map<ProceduralCityStyle, THREE.Texture>()
const wallMaterialByStyle = new Map<ProceduralCityStyle, THREE.Material>()
let solidOutlineMaterial: THREE.ShaderMaterial | null = null
const proceduralCityOutlineResolution = new THREE.Vector2()

function loadFacadeTexture(style: unknown): THREE.Texture {
  const resolvedStyle = resolveProceduralCityStyle(style)
  const cachedTexture = facadeTextureByStyle.get(resolvedStyle)
  if (cachedTexture) {
    return cachedTexture
  }
  const theme = getProceduralCityStyleTheme(resolvedStyle)
  try {
    if (resolvedStyle === 'office') {
      const canvas = createCanvas(32, 64)
      canvas.width = 32
      canvas.height = 64
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      let seed = 0x2f6e2b1
      const nextRandom = () => {
        seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0
        return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296
      }
      for (let y = 2; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          const value = Math.floor(nextRandom() * 64)
          context.fillStyle = `rgb(${value}, ${value}, ${value})`
          context.fillRect(x, y, 2, 1)
        }
      }
      const upscale = createCanvas(PROCEDURAL_CITY_FACADE_LOW_QUALITY_WIDTH, PROCEDURAL_CITY_FACADE_LOW_QUALITY_HEIGHT)
      upscale.width = PROCEDURAL_CITY_FACADE_LOW_QUALITY_WIDTH
      upscale.height = PROCEDURAL_CITY_FACADE_LOW_QUALITY_HEIGHT
      const upscaleContext = upscale.getContext('2d')!
      upscaleContext.imageSmoothingEnabled = false
      upscaleContext.drawImage(canvas as unknown as CanvasImageSource, 0, 0, upscale.width, upscale.height)
      const texture = configureCityTexture(new THREE.CanvasTexture(upscale as unknown as CanvasImageSource))
      texture.needsUpdate = true
      facadeTextureByStyle.set(resolvedStyle, texture)
      return texture
    }
    const canvas = createCanvas(PROCEDURAL_CITY_FACADE_SOURCE_WIDTH, PROCEDURAL_CITY_FACADE_SOURCE_HEIGHT)
    canvas.width = PROCEDURAL_CITY_FACADE_SOURCE_WIDTH
    canvas.height = PROCEDURAL_CITY_FACADE_SOURCE_HEIGHT
    const context = canvas.getContext('2d')!
    context.fillStyle = theme.wallShades[0]!
    context.fillRect(0, 0, canvas.width, canvas.height)
    let seed = 0x2f6e2b1
    const nextRandom = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296
    }
    const floorHeight = 18
    const columnCount = 6
    const wallShades = theme.wallShades
    const frameShade = theme.frameShade
    const windowLit = theme.windowLit
    const windowDark = theme.windowDark
    const officeStyle = style === 'office'
    for (let y = 0; y < canvas.height; y += floorHeight) {
      const bandIndex = Math.floor(nextRandom() * wallShades.length)
      const bandShade = wallShades[bandIndex]!
      context.fillStyle = bandShade
      context.fillRect(0, y, canvas.width, floorHeight)
      if (theme.alternateFloorBands && (Math.floor(y / floorHeight) % 2 === 1)) {
        context.fillStyle = officeStyle
          ? `rgba(255,255,255,${theme.bandTint})`
          : `rgba(255,255,255,${theme.bandTint})`
        context.fillRect(0, y, canvas.width, floorHeight)
      }
      context.fillStyle = `rgba(255,255,255,${theme.floorBandAlpha})`
      context.fillRect(0, y, canvas.width, 1)
      context.fillStyle = officeStyle ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.035)'
      context.fillRect(0, y + floorHeight - 1, canvas.width, 1)
      const innerHeight = officeStyle ? floorHeight - 8 : floorHeight - 4
      const innerY = officeStyle ? y + 4 : y + 2
      for (let column = 0; column < columnCount; column += 1) {
        const span = canvas.width / columnCount
        const windowWidth = Math.max(4, Math.floor(span * (officeStyle ? 0.16 : 0.24) + nextRandom() * span * theme.windowGap))
        const windowHeight = Math.max(3, Math.floor(innerHeight * (officeStyle ? 0.5 : 0.7 + nextRandom() * 0.12)))
        const offsetX = Math.floor(span * (officeStyle ? 0.18 : 0.14) + nextRandom() * span * theme.windowGap)
        const windowX = Math.floor(column * span + offsetX)
        const windowY = Math.floor(innerY + (innerHeight - windowHeight) * 0.5)
        context.fillStyle = frameShade
        context.fillRect(windowX - 2, windowY - 1, windowWidth + 4, windowHeight + 2)
        const lit = nextRandom() > theme.litChance
        context.fillStyle = lit ? windowLit[Math.floor(nextRandom() * windowLit.length)]! : windowDark[Math.floor(nextRandom() * windowDark.length)]!
        context.fillRect(windowX, windowY, windowWidth, windowHeight)
        if (lit) {
          context.fillStyle = officeStyle ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)'
          context.fillRect(windowX, windowY, windowWidth, 1)
        }
      }
    }
    const upscale = createCanvas(PROCEDURAL_CITY_FACADE_LOW_QUALITY_WIDTH, PROCEDURAL_CITY_FACADE_LOW_QUALITY_HEIGHT)
    upscale.width = PROCEDURAL_CITY_FACADE_LOW_QUALITY_WIDTH
    upscale.height = PROCEDURAL_CITY_FACADE_LOW_QUALITY_HEIGHT
    const upscaleContext = upscale.getContext('2d')!
    upscaleContext.imageSmoothingEnabled = false
    upscaleContext.drawImage(canvas as unknown as CanvasImageSource, 0, 0, upscale.width, upscale.height)
    const texture = configureCityTexture(new THREE.CanvasTexture(upscale as unknown as CanvasImageSource))
    texture.needsUpdate = true
    facadeTextureByStyle.set(resolvedStyle, texture)
    return texture
  } catch {
    // If canvas creation fails in a constrained runtime, fall back to a tiny data texture.
  }
  const data = new Uint8Array([
    220, 216, 207, 255, 218, 214, 206, 255,
    215, 210, 202, 255, 217, 212, 204, 255,
  ])
  const texture = configureCityTexture(new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat))
  texture.needsUpdate = true
  facadeTextureByStyle.set(resolvedStyle, texture)
  return texture
}

function applyProceduralCitySolidLighting(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSolidLightDirection = { value: PROCEDURAL_CITY_SOLID_LIGHT_DIRECTION.clone() }
    shader.uniforms.uSolidLightAmbient = { value: PROCEDURAL_CITY_SOLID_LIGHT_AMBIENT }
    shader.uniforms.uSolidLightDiffuse = { value: PROCEDURAL_CITY_SOLID_LIGHT_DIFFUSE }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vSolidWorldNormal;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vec3 solidNormal = normal;',
          '#ifdef USE_INSTANCING',
          'mat3 solidInstanceBasis = mat3(instanceMatrix);',
          'solidNormal /= vec3(',
          '  dot(solidInstanceBasis[0], solidInstanceBasis[0]),',
          '  dot(solidInstanceBasis[1], solidInstanceBasis[1]),',
          '  dot(solidInstanceBasis[2], solidInstanceBasis[2])',
          ');',
          'solidNormal = solidInstanceBasis * solidNormal;',
          '#endif',
          'vSolidWorldNormal = normalize(mat3(modelMatrix) * solidNormal);',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vSolidWorldNormal;',
          'uniform vec3 uSolidLightDirection;',
          'uniform float uSolidLightAmbient;',
          'uniform float uSolidLightDiffuse;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float solidNdotL = max(dot(normalize(vSolidWorldNormal), normalize(uSolidLightDirection)), 0.0);',
          'diffuseColor.rgb *= uSolidLightAmbient + uSolidLightDiffuse * solidNdotL;',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'procedural-city-solid-lighting-v1'
}

/**
 * The shared wall material for a city style, cached per style. Both this component
 * and any other consumer must go through here so they also share the generated
 * facade texture and the injected lighting.
 */
export function getWallMaterial(style: unknown): THREE.Material {
  const resolvedStyle = resolveProceduralCityStyle(style)
  const cachedMaterial = wallMaterialByStyle.get(resolvedStyle)
  if (cachedMaterial) {
    return cachedMaterial
  }
  if (resolvedStyle === 'solid') {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
    })
    applyProceduralCitySolidLighting(material)
    wallMaterialByStyle.set(resolvedStyle, material)
    return material
  }
  const material = new THREE.MeshBasicMaterial({
    map: loadFacadeTexture(resolvedStyle),
    vertexColors: true,
  })
  wallMaterialByStyle.set(resolvedStyle, material)
  return material
}

const PROCEDURAL_CITY_SOLID_OUTLINE_VERTEX_SHADER = `
uniform vec2 uResolution;
uniform float uOutlinePixels;
uniform float uNearOpacity;
uniform float uFarOpacity;
uniform float uNearDistance;
uniform float uFarDistance;
varying float vOutlineOpacity;

void main() {
  mat3 instanceBasis = mat3(instanceMatrix);
  vec3 transformedNormal = normal;
  transformedNormal /= vec3(
    dot(instanceBasis[0], instanceBasis[0]),
    dot(instanceBasis[1], instanceBasis[1]),
    dot(instanceBasis[2], instanceBasis[2])
  );
  transformedNormal = instanceBasis * transformedNormal;
  vec3 viewNormal = normalize(normalMatrix * transformedNormal);

  vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * viewPosition;
  vec2 screenNormal = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
  float screenNormalLength = length(screenNormal);
  screenNormal = screenNormalLength > 1e-5 ? screenNormal / screenNormalLength : vec2(0.0);
  clipPosition.xy += screenNormal * (uOutlinePixels * 2.0 / uResolution) * clipPosition.w;

  vec4 viewCenter = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float viewDistance = length(viewCenter.xyz);
  float distanceFade = smoothstep(uNearDistance, uFarDistance, viewDistance);
  vOutlineOpacity = mix(uNearOpacity, uFarOpacity, distanceFade);
  gl_Position = clipPosition;
}
`

const PROCEDURAL_CITY_SOLID_OUTLINE_FRAGMENT_SHADER = `
uniform vec3 uOutlineColor;
varying float vOutlineOpacity;

void main() {
  if (vOutlineOpacity <= 0.001) {
    discard;
  }
  gl_FragColor = vec4(uOutlineColor, vOutlineOpacity);
  #include <colorspace_fragment>
}
`

/**
 * The screen-space outline that fattens a solid-style building. Its vertex shader
 * reads `instanceMatrix` unconditionally, so it only works on an InstancedMesh.
 */
export function getSolidOutlineMaterial(): THREE.ShaderMaterial {
  if (!solidOutlineMaterial) {
    solidOutlineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uOutlinePixels: { value: PROCEDURAL_CITY_SOLID_OUTLINE_PIXELS },
        uOutlineColor: { value: new THREE.Color(PROCEDURAL_CITY_SOLID_OUTLINE_COLOR) },
        uNearOpacity: { value: PROCEDURAL_CITY_SOLID_OUTLINE_NEAR_OPACITY },
        uFarOpacity: { value: PROCEDURAL_CITY_SOLID_OUTLINE_FAR_OPACITY },
        uNearDistance: { value: PROCEDURAL_CITY_SOLID_OUTLINE_NEAR_DISTANCE },
        uFarDistance: { value: PROCEDURAL_CITY_SOLID_OUTLINE_FAR_DISTANCE },
      },
      vertexShader: PROCEDURAL_CITY_SOLID_OUTLINE_VERTEX_SHADER,
      fragmentShader: PROCEDURAL_CITY_SOLID_OUTLINE_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
  }
  return solidOutlineMaterial
}

export function configureSolidOutlineMesh(mesh: THREE.InstancedMesh): void {
  const material = mesh.material as THREE.ShaderMaterial
  mesh.onBeforeRender = (renderer: THREE.WebGLRenderer): void => {
    renderer.getDrawingBufferSize(proceduralCityOutlineResolution)
    material.uniforms.uResolution!.value.set(
      Math.max(1, proceduralCityOutlineResolution.x),
      Math.max(1, proceduralCityOutlineResolution.y),
    )
    material.uniforms.uOutlinePixels!.value = PROCEDURAL_CITY_SOLID_OUTLINE_PIXELS * renderer.getPixelRatio()
  }
}
