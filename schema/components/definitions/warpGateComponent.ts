import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const WARP_GATE_COMPONENT_TYPE = 'warpGate'
export const DEFAULT_GROUND_LIGHT_COLOR = '#00ffff'
export const DEFAULT_GROUND_LIGHT_INTENSITY = 1
export const DEFAULT_GROUND_LIGHT_SCALE = 1
export const DEFAULT_GROUND_LIGHT_PARTICLE_SIZE = 0.12
export const DEFAULT_GROUND_LIGHT_PARTICLE_COUNT = 160
export const DEFAULT_GROUND_LIGHT_SHOW_PARTICLES = false
export const DEFAULT_GROUND_LIGHT_SHOW_BEAMS = true
export const DEFAULT_GROUND_LIGHT_SHOW_RINGS = true
export const GROUND_LIGHT_INTENSITY_MIN = 0
export const GROUND_LIGHT_INTENSITY_MAX = 5
export const GROUND_LIGHT_PARTICLE_SIZE_MIN = 0.02
export const GROUND_LIGHT_PARTICLE_SIZE_MAX = 0.4
export const GROUND_LIGHT_PARTICLE_COUNT_MIN = 0
export const GROUND_LIGHT_PARTICLE_COUNT_MAX = 600
export const WARP_GATE_RUNTIME_REGISTRY_KEY = '__harmonyWarpGateRuntime'
export const WARP_GATE_EFFECT_METADATA_KEY = '__harmonyWarpGateEffect'
export const WARP_GATE_EFFECT_ACTIVE_FLAG = '__harmonyWarpGateEffectActive'

export interface WarpGateComponentProps {
  color: string
  intensity: number
  particleSize: number
  particleCount: number
  showParticles: boolean
  showBeams: boolean
  showRings: boolean
}
export type WarpGateEffectProps = WarpGateComponentProps
export type GroundLightEffectProps = WarpGateComponentProps

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const color = (v: unknown) => {
  const value = typeof v === 'string' ? v.trim() : ''
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (!match) return DEFAULT_GROUND_LIGHT_COLOR
  const hex = match[1] ?? ''
  return `#${hex.length === 3 ? hex.split('').map((x) => `${x ?? ''}${x ?? ''}`).join('') : hex}`
}
const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback

export function clampWarpGateComponentProps(props: Partial<WarpGateComponentProps> | null | undefined): WarpGateComponentProps {
  const source = props ?? {}
  return {
    color: color(source.color),
    intensity: clamp(source.intensity, GROUND_LIGHT_INTENSITY_MIN, GROUND_LIGHT_INTENSITY_MAX, DEFAULT_GROUND_LIGHT_INTENSITY),
    particleSize: clamp(source.particleSize, GROUND_LIGHT_PARTICLE_SIZE_MIN, GROUND_LIGHT_PARTICLE_SIZE_MAX, DEFAULT_GROUND_LIGHT_PARTICLE_SIZE),
    particleCount: Math.round(clamp(source.particleCount, GROUND_LIGHT_PARTICLE_COUNT_MIN, GROUND_LIGHT_PARTICLE_COUNT_MAX, DEFAULT_GROUND_LIGHT_PARTICLE_COUNT)),
    showParticles: bool(source.showParticles, DEFAULT_GROUND_LIGHT_SHOW_PARTICLES),
    showBeams: bool(source.showBeams, DEFAULT_GROUND_LIGHT_SHOW_BEAMS),
    showRings: bool(source.showRings, DEFAULT_GROUND_LIGHT_SHOW_RINGS),
  }
}
export function cloneWarpGateComponentProps(props: WarpGateComponentProps): WarpGateComponentProps { return { ...props } }
export function computeWarpGateEffectActive(props: WarpGateComponentProps): boolean {
  return props.showBeams || props.showRings || (props.showParticles && props.particleCount > 0)
}

const vertex = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
const fragment = `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uIntensity; void main(){float edge=smoothstep(1.0,0.0,abs(vUv.x-.5)*2.0);float fade=smoothstep(1.0,0.0,vUv.y);float wave=.65+.2*sin(uTime*3.2+vUv.x*14.)+.15*sin(uTime*4.+vUv.y*9.);float a=edge*fade*wave*clamp(uIntensity/3.5,0.,1.4);if(a<.02)discard;gl_FragColor=vec4(uColor,a);}`
let particleTexture: THREE.DataTexture | null = null
function getParticleTexture() {
  if (particleTexture) return particleTexture
  const size = 32; const data = new Uint8Array(size * size * 4); const c = (size - 1) / 2
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const a = Math.max(0, 1 - Math.hypot(x - c, y - c) / c) ** 2; const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255) }
  particleTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); particleTexture.needsUpdate = true; particleTexture.magFilter = THREE.LinearFilter; particleTexture.minFilter = THREE.LinearFilter; return particleTexture
}

export interface WarpGateEffectInstance { group: THREE.Group; update(props: WarpGateComponentProps): void; tick(delta: number): void; dispose(): void }
class WarpGateEffectController implements WarpGateEffectInstance {
  readonly group = new THREE.Group(); private readonly beamGroup = new THREE.Group(); private readonly beams: THREE.ShaderMaterial[] = []; private readonly rings: THREE.Mesh[] = []; private readonly disc: THREE.Mesh; private readonly particles: THREE.Points; private readonly particleGeometry = new THREE.BufferGeometry(); private velocities = new Float32Array(); private elapsed = 0; private props: WarpGateComponentProps; private disposed = false
  constructor(initial: WarpGateComponentProps) {
    this.group.name = 'Effect:WarpGate'; this.group.scale.setScalar(DEFAULT_GROUND_LIGHT_SCALE); this.beamGroup.name = 'Effect:WarpGate:Beams'; this.group.add(this.beamGroup)
    const beamGeometry = new THREE.PlaneGeometry(.26, 2); beamGeometry.translate(0, 1, 0)
    for (let i = 0; i < 16; i++) { const material = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uIntensity: { value: 1 } }, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); const mesh = new THREE.Mesh(beamGeometry, material); const a = i / 16 * Math.PI * 2; mesh.position.set(Math.cos(a) * .375, 0, Math.sin(a) * .375); mesh.rotation.y = a; this.beamGroup.add(mesh); this.beams.push(material) }
    for (let i = 0; i < 3; i++) { const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); const mesh = new THREE.Mesh(new THREE.RingGeometry(.225 + i * .11, .445 + i * .11, 64), material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = .01 + i * .008; this.group.add(mesh); this.rings.push(mesh) }
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(.14, 48), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); this.disc.rotation.x = -Math.PI / 2; this.disc.position.y = .015; this.group.add(this.disc)
    const particleMaterial = new THREE.PointsMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, size: DEFAULT_GROUND_LIGHT_PARTICLE_SIZE, map: getParticleTexture(), alphaTest: .15 }); this.particles = new THREE.Points(this.particleGeometry, particleMaterial); this.group.add(this.particles); this.props = clampWarpGateComponentProps(initial); this.update(this.props)
  }
  update(props: WarpGateComponentProps) { this.props = clampWarpGateComponentProps(props); const c = new THREE.Color(this.props.color); this.beams.forEach((m) => { const u = m.uniforms as any; u.uColor.value.copy(c); u.uIntensity.value = this.props.intensity }); this.rings.forEach((m, i) => { (m.material as THREE.MeshBasicMaterial).color.copy(c); m.visible = this.props.showRings; (m.material as THREE.MeshBasicMaterial).opacity = (.28 - i * .06) * (.35 + this.props.intensity / 5 * .9) }); (this.disc.material as THREE.MeshBasicMaterial).color.copy(c); this.disc.visible = this.props.showRings; const pm = this.particles.material as THREE.PointsMaterial; pm.color.copy(c); pm.size = this.props.particleSize; this.beamGroup.visible = this.props.showBeams; this.particles.visible = this.props.showParticles && this.props.particleCount > 0; this.rebuildParticles() }
  private rebuildParticles() { if (this.velocities.length === this.props.particleCount) return; const n = this.props.particleCount; const p = new Float32Array(n * 3); this.velocities = new Float32Array(n); for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; const r = Math.random() * .35; p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = Math.random() * 2; p[i * 3 + 2] = Math.sin(a) * r; this.velocities[i] = .5 + Math.random() * 1.4 } const attr = new THREE.BufferAttribute(p, 3); attr.setUsage(THREE.DynamicDrawUsage); this.particleGeometry.setAttribute('position', attr) }
  tick(delta: number) { if (this.disposed || !Number.isFinite(delta) || delta <= 0) return; this.elapsed += delta; this.beams.forEach((m) => { const u = m.uniforms as any; u.uTime.value = this.elapsed }); if (this.props.showBeams) this.beamGroup.rotation.y += delta * .35; this.rings.forEach((m, i) => { m.rotation.z += delta * (.25 + i * .08); (m.material as THREE.MeshBasicMaterial).opacity *= .98 + Math.sin(this.elapsed * 2 + i) * .01 }); const attr = this.particleGeometry.getAttribute('position') as THREE.BufferAttribute | undefined; if (attr && this.props.showParticles) { const p = attr.array as Float32Array; for (let i = 0; i < this.velocities.length; i++) { p[i * 3 + 1] = (p[i * 3 + 1] ?? 0) + (this.velocities[i] ?? 0) * delta; if ((p[i * 3 + 1] ?? 0) > 2) p[i * 3 + 1] = 0 } attr.needsUpdate = true } }
  dispose() { if (this.disposed) return; this.disposed = true; this.beams.forEach((m) => m.dispose()); this.beamGroup.children[0] && (this.beamGroup.children[0] as THREE.Mesh).geometry.dispose(); this.rings.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose() }); this.disc.geometry.dispose(); (this.disc.material as THREE.Material).dispose(); this.particleGeometry.dispose(); (this.particles.material as THREE.Material).dispose() }
}
export function createWarpGateEffectInstance(initial: WarpGateComponentProps): WarpGateEffectInstance { return new WarpGateEffectController(initial) }

type RuntimeEntry = { getProps(): WarpGateComponentProps; setProps(patch: Partial<WarpGateComponentProps> | null | undefined): void; tick(delta: number): void; props: WarpGateComponentProps; setPlaybackActive?(active: boolean): void }
class WarpGateComponent extends Component<WarpGateComponentProps> { private controller: WarpGateEffectInstance | null = null; private object: Object3D | null = null; private current = clampWarpGateComponentProps(null); private playback = true
  constructor(context: ComponentRuntimeContext<WarpGateComponentProps>) { super(context); this.current = clampWarpGateComponentProps(context.getProps()) }
  onRuntimeAttached(object: Object3D | null) { this.apply(object) }
  onPropsUpdated() { this.apply(this.object) }
  onEnabledChanged() { this.apply(this.object) }
  onUpdate(delta: number) { if (this.playback) this.controller?.tick(delta) }
  onDestroy() { this.clear(); this.unregister(this.object); this.object = null }
  private apply(object: Object3D | null) { const previous = this.object; if (!object || !this.context.isEnabled()) { this.clear(); this.unregister(previous); this.object = object; return } if (previous && previous !== object) { this.clear(); this.unregister(previous) } this.object = object; this.current = clampWarpGateComponentProps(this.context.getProps()); if (!this.controller) { this.controller = createWarpGateEffectInstance(this.current); object.add(this.controller.group) } else if (this.controller.group.parent !== object) object.add(this.controller.group); this.controller.update(this.current); const data = object.userData ?? (object.userData = {}); data.warpGate = true; data[WARP_GATE_EFFECT_METADATA_KEY] = cloneWarpGateComponentProps(this.current); data[WARP_GATE_EFFECT_ACTIVE_FLAG] = computeWarpGateEffectActive(this.current); this.register(object) }
  private clear() { if (!this.controller) return; this.controller.group.removeFromParent(); this.controller.dispose(); this.controller = null; this.playback = true }
  private register(object: Object3D) { const data = object.userData ?? (object.userData = {}); const registry = (data[WARP_GATE_RUNTIME_REGISTRY_KEY] ??= {}) as Record<string, RuntimeEntry>; const self = this; registry[this.context.componentId] = { getProps: () => cloneWarpGateComponentProps(self.current), setProps(patch) { if (patch) { self.current = clampWarpGateComponentProps({ ...self.current, ...patch }); self.controller?.update(self.current) } }, tick: (delta) => { if (self.playback) self.controller?.tick(delta) }, props: cloneWarpGateComponentProps(this.current), setPlaybackActive: (active) => { self.playback = active } } }
  private unregister(object: Object3D | null | undefined) { const registry = object?.userData?.[WARP_GATE_RUNTIME_REGISTRY_KEY] as Record<string, RuntimeEntry> | undefined; if (!registry) return; delete registry[this.context.componentId]; if (!Object.keys(registry).length) delete object?.userData?.[WARP_GATE_RUNTIME_REGISTRY_KEY] }
}
const warpGateComponentDefinition: ComponentDefinition<WarpGateComponentProps> = { type: WARP_GATE_COMPONENT_TYPE, label: 'Warp Gate', icon: 'mdi-vector-circle', order: 50, inspector: [], canAttach: () => true, createDefaultProps: () => clampWarpGateComponentProps(null), createInstance: (context) => new WarpGateComponent(context) }
componentManager.registerDefinition(warpGateComponentDefinition)
export function createWarpGateComponentState(node: SceneNode, overrides?: Partial<WarpGateComponentProps>, options: { id?: string; enabled?: boolean } = {}): SceneNodeComponentState<WarpGateComponentProps> { return { id: options.id ?? '', type: WARP_GATE_COMPONENT_TYPE, enabled: options.enabled ?? true, props: clampWarpGateComponentProps({ ...warpGateComponentDefinition.createDefaultProps(node), ...overrides }) } }
export { warpGateComponentDefinition }
