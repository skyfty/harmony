import * as THREE from 'three'

export type GradientBackgroundSettingsInput = {
  topColor: THREE.ColorRepresentation
  bottomColor: THREE.ColorRepresentation
  offset?: number
  exponent?: number
}

export type GradientBackgroundDome = {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  geometry: THREE.SphereGeometry
  uniforms: {
    topColor: { value: THREE.Color }
    bottomColor: { value: THREE.Color }
    offset: { value: number }
    exponent: { value: number }
  }
}

const DEFAULT_OFFSET = 33
const DEFAULT_EXPONENT = 0.6

const VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`

const FRAGMENT_SHADER = `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;

  varying vec3 vWorldPosition;

  void main() {
    float h = normalize( vWorldPosition + vec3( 0.0, offset, 0.0 ) ).y;
    float t = max( pow( max( h, 0.0 ), exponent ), 0.0 );
    gl_FragColor = vec4( mix( bottomColor, topColor, t ), 1.0 );
  }
`

export function createGradientBackgroundDome(settings: GradientBackgroundSettingsInput): GradientBackgroundDome {
  const uniforms = {
    topColor: { value: new THREE.Color(settings.topColor) },
    bottomColor: { value: new THREE.Color(settings.bottomColor) },
    offset: { value: Number.isFinite(settings.offset as number) ? (settings.offset as number) : DEFAULT_OFFSET },
    exponent: { value: Number.isFinite(settings.exponent as number) ? (settings.exponent as number) : DEFAULT_EXPONENT },
  } as const

  const geometry = new THREE.SphereGeometry(4000, 32, 15)
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as any,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.name = 'HarmonyGradientBackground'

  return { mesh, material, geometry, uniforms: uniforms as any }
}

export function disposeGradientBackgroundDome(dome: GradientBackgroundDome | null | undefined): void {
  if (!dome) {
    return
  }
  try {
    dome.mesh.parent?.remove(dome.mesh)
  } catch {
    // ignore
  }
  dome.geometry.dispose()
  dome.material.dispose()
}
