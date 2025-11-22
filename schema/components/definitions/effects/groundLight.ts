import * as THREE from 'three'
import type {
  EffectComponentProps,
  EffectController,
  GroundLightEffectProps,
} from './types'

export const DEFAULT_GROUND_LIGHT_COLOR = '#00ffff'
export const DEFAULT_GROUND_LIGHT_INTENSITY = 1
export const DEFAULT_GROUND_LIGHT_SCALE = 1
export const GROUND_LIGHT_INTENSITY_MIN = 0
export const GROUND_LIGHT_INTENSITY_MAX = 5
export const GROUND_LIGHT_SCALE_MIN = 0.2
export const GROUND_LIGHT_SCALE_MAX = 3

const GROUND_LIGHT_GROUP_NAME = 'Effect:GroundLight'
const GROUND_LIGHT_BEAM_COUNT = 16
const GROUND_LIGHT_BEAM_HEIGHT = 6
const GROUND_LIGHT_BEAM_RADIUS = 1.4
const GROUND_LIGHT_RING_COUNT = 3
const GROUND_LIGHT_RING_WIDTH = 0.22
const GROUND_LIGHT_PARTICLE_COUNT = 160
const GROUND_LIGHT_PARTICLE_SIZE = 0.12

const GROUND_LIGHT_BEAM_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GROUND_LIGHT_BEAM_FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  float remap(float value, float inMin, float inMax, float outMin, float outMax) {
    return outMin + (outMax - outMin) * clamp((value - inMin) / max(inMax - inMin, 0.0001), 0.0, 1.0);
  }

  void main() {
    float radial = abs(vUv.x - 0.5) * 2.0;
    float vertical = clamp(vUv.y, 0.0, 1.0);
    float edgeFade = smoothstep(1.0, 0.0, radial);
    float heightFade = smoothstep(1.0, 0.0, vertical);
    float swirl = sin(uTime * 3.2 + radial * 14.0);
    float wave = sin(uTime * 4.0 + vertical * 9.0);
    float flicker = 0.65 + 0.35 * sin(uTime * 5.0 + radial * 6.0);
    float intensityScale = remap(clamp(uIntensity, 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0), 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0, 0.0, 1.4);
    float alpha = edgeFade * heightFade * (0.55 + 0.25 * swirl + 0.2 * wave) * flicker * intensityScale;
    if (alpha <= 0.02) {
      discard;
    }
    gl_FragColor = vec4(uColor, alpha);
  }
`

type BeamEntry = {
  material: THREE.ShaderMaterial
  uniforms: {
    uTime: { value: number }
    uColor: { value: THREE.Color }
    uIntensity: { value: number }
  }
}

type RingEntry = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  baseOpacity: number
  rotationSpeed: number
  pulseOffset: number
}

type ParticleState = {
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  velocities: Float32Array
}

class GroundLightEffectController implements EffectController {
  readonly group: THREE.Group
  private readonly beams: BeamEntry[] = []
  private readonly beamGeometry: THREE.PlaneGeometry
  private readonly beamGroup: THREE.Group
  private readonly ringEntries: RingEntry[] = []
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly centerDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly particleState: ParticleState
  private readonly particleSystem: THREE.Points
  private elapsed = 0
  private readonly color = new THREE.Color(DEFAULT_GROUND_LIGHT_COLOR)
  private intensity = DEFAULT_GROUND_LIGHT_INTENSITY
  private intensityFactor = 1
  private scale = DEFAULT_GROUND_LIGHT_SCALE
  private disposed = false

  constructor(initial: GroundLightEffectProps) {
    this.group = new THREE.Group()
    this.group.name = GROUND_LIGHT_GROUP_NAME
    this.group.matrixAutoUpdate = true
    this.group.scale.setScalar(DEFAULT_GROUND_LIGHT_SCALE)

    this.beamGeometry = new THREE.PlaneGeometry(0.26, GROUND_LIGHT_BEAM_HEIGHT, 1, 1)
    this.beamGeometry.translate(0, GROUND_LIGHT_BEAM_HEIGHT * 0.5, 0)

    this.beamGroup = new THREE.Group()
    this.beamGroup.name = `${GROUND_LIGHT_GROUP_NAME}:Beams`
    this.group.add(this.beamGroup)

    for (let index = 0; index < GROUND_LIGHT_BEAM_COUNT; index += 1) {
      const angle = (index / GROUND_LIGHT_BEAM_COUNT) * Math.PI * 2
      const uniforms = {
        uTime: { value: 0 },
        uColor: { value: this.color.clone() },
        uIntensity: { value: this.intensity },
      }
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: GROUND_LIGHT_BEAM_VERTEX_SHADER,
        fragmentShader: GROUND_LIGHT_BEAM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.beamGeometry, material)
      const radius = GROUND_LIGHT_BEAM_RADIUS * 0.75
      mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      mesh.rotation.y = angle
      this.beamGroup.add(mesh)
      this.beams.push({ material, uniforms })
    }

    for (let index = 0; index < GROUND_LIGHT_RING_COUNT; index += 1) {
      const innerRadius = GROUND_LIGHT_BEAM_RADIUS * (0.45 + index * 0.22)
      const outerRadius = innerRadius + GROUND_LIGHT_RING_WIDTH
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64)
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.28 - index * 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.01 + index * 0.008
      this.group.add(mesh)
      this.rings.push(mesh)
      this.ringEntries.push({
        mesh,
        baseOpacity: material.opacity,
        rotationSpeed: 0.25 + index * 0.08,
        pulseOffset: index * 0.9,
      })
    }

    const discGeometry = new THREE.CircleGeometry(GROUND_LIGHT_BEAM_RADIUS * 0.28, 48)
    const discMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.centerDisc = new THREE.Mesh(discGeometry, discMaterial)
    this.centerDisc.rotation.x = -Math.PI / 2
    this.centerDisc.position.y = 0.015
    this.group.add(this.centerDisc)

    const particleGeometry = new THREE.BufferGeometry()
    const positions = new Float32Array(GROUND_LIGHT_PARTICLE_COUNT * 3)
    const velocities = new Float32Array(GROUND_LIGHT_PARTICLE_COUNT)
    for (let i = 0; i < GROUND_LIGHT_PARTICLE_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * (GROUND_LIGHT_BEAM_RADIUS * 0.7)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = Math.random() * GROUND_LIGHT_BEAM_HEIGHT
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      velocities[i] = 0.5 + Math.random() * 1.4
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const particleMaterial = new THREE.PointsMaterial({
      color: this.color,
      size: GROUND_LIGHT_PARTICLE_SIZE,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.particleState = {
      geometry: particleGeometry,
      material: particleMaterial,
      velocities,
    }
    this.particleSystem = new THREE.Points(particleGeometry, particleMaterial)
    this.group.add(this.particleSystem)
    this.applySettings(initial)
  }

  update(props: EffectComponentProps): void {
    this.applySettings(props.groundLight)
  }

  tick(delta: number): void {
    if (this.disposed) {
      return
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return
    }
    const step = Math.max(delta, 0)
    this.elapsed += step

    this.beams.forEach((entry) => {
      entry.uniforms.uTime.value = this.elapsed
      entry.uniforms.uIntensity.value = this.intensity
      entry.uniforms.uColor.value.copy(this.color)
    })
    this.beamGroup.rotation.y += step * 0.35 * (0.8 + this.intensityFactor * 0.4)

    this.ringEntries.forEach((entry, index) => {
      const oscillation = 0.75 + 0.25 * Math.sin(this.elapsed * 2.2 + entry.pulseOffset)
      entry.mesh.material.opacity = entry.baseOpacity * oscillation * this.intensityFactor
      entry.mesh.rotation.z += entry.rotationSpeed * step
      if (index === 0) {
        const scalePulse = 1 + Math.sin(this.elapsed * 1.8) * 0.05 * this.intensityFactor
        entry.mesh.scale.setScalar(scalePulse)
      }
    })

    this.centerDisc.material.opacity = 0.55 * this.intensityFactor

    const positionAttribute = this.particleState.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positionAttribute) {
      return
    }
    const positions = positionAttribute.array as Float32Array | undefined
    if (!positions) {
      return
    }
    const velocities = this.particleState.velocities
    const riseSpeed = 0.8 + this.intensityFactor * 1.1
    for (let i = 0; i < GROUND_LIGHT_PARTICLE_COUNT; i += 1) {
      const offset = i * 3 + 1
      const currentValue = positions[offset] ?? 0
      const velocity = velocities[i] ?? 0
      let nextValue = currentValue + velocity * riseSpeed * step
      if (nextValue > GROUND_LIGHT_BEAM_HEIGHT) {
        nextValue = 0
      }
      positions[offset] = nextValue
    }
    positionAttribute.needsUpdate = true
    this.particleState.material.opacity = 0.4 + 0.4 * this.intensityFactor
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.beams.forEach((entry) => {
      entry.material.dispose()
    })
    this.beamGeometry.dispose()
    this.rings.forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    this.centerDisc.geometry.dispose()
    this.centerDisc.material.dispose()
    this.particleState.geometry.dispose()
    this.particleState.material.dispose()
  }

  private applySettings(settings: GroundLightEffectProps): void {
    this.setColor(settings.color)
    this.setIntensity(settings.intensity)
    this.setScale(settings.scale)
  }

  private setColor(color: string): void {
    this.color.set(color)
    this.rings.forEach((mesh) => {
      mesh.material.color.copy(this.color)
    })
    this.centerDisc.material.color.copy(this.color)
    this.particleState.material.color.copy(this.color)
  }

  private setIntensity(intensity: number): void {
    this.intensity = Math.min(Math.max(intensity, GROUND_LIGHT_INTENSITY_MIN), GROUND_LIGHT_INTENSITY_MAX)
    const normalized = this.intensity
    const factor = normalized <= 0 ? 0 : 0.35 + (normalized / GROUND_LIGHT_INTENSITY_MAX) * 0.9
    this.intensityFactor = factor
  }

  private setScale(scale: number): void {
    const clamped = Math.min(Math.max(scale, GROUND_LIGHT_SCALE_MIN), GROUND_LIGHT_SCALE_MAX)
    if (Math.abs(clamped - this.scale) <= 1e-4) {
      return
    }
    this.scale = clamped
    this.group.scale.setScalar(this.scale)
  }
}

export function createGroundLightEffectController(initial: GroundLightEffectProps): EffectController {
  return new GroundLightEffectController(initial)
}
