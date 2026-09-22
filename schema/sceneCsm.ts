import * as THREE from 'three'
import CSM from 'three-csm'

import {
  DEFAULT_SCENE_CSM_CONFIG,
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
  type SceneCsmConfig,
  type SceneCsmMode,
} from './sceneCsmDefaults'
export {
  DEFAULT_SCENE_CSM_CONFIG,
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
} from './sceneCsmDefaults'
export type {
  SceneCsmConfig,
  SceneCsmMode,
  SceneCsmRuntimeProfile,
} from './sceneCsmDefaults'
export {
  LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_COUNT,
  LARGE_SCENE_INSTANCED_SHADOW_RECEIVER_ONLY_RADIUS,
  shouldUseReceiverOnlyForDenseInstancedMesh,
} from './sceneCsmReceiverPolicy'

function clampSunAngle(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export function resolveSceneCsmSunPositionFromAngles(
  azimuthDeg: number,
  elevationDeg: number,
  radius = 1,
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(
    clampSunAngle(azimuthDeg, -180, 180, DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG),
  )
  const elevation = THREE.MathUtils.degToRad(
    clampSunAngle(elevationDeg, -10, 89, DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG),
  )
  const resolvedRadius = Number.isFinite(radius) && radius > 0 ? radius : 1

  const cosElevation = Math.cos(elevation)
  const x = Math.sin(azimuth) * cosElevation
  const y = Math.sin(elevation)
  const z = Math.cos(azimuth) * cosElevation
  return new THREE.Vector3(x, y, z).multiplyScalar(resolvedRadius)
}

const tempSunDirection = new THREE.Vector3()
const defaultSunDirection = new THREE.Vector3(0, -1, 0)
const cameraStateEpsilon = 1e-8
const baseThreeLightsFragmentBegin = THREE.ShaderChunk.lights_fragment_begin
const directionalLightsBlockPattern = /#if \( NUM_DIR_LIGHTS > 0 \) && defined\( RE_Direct \)[\s\S]*?#endif\n\n#if \( NUM_RECT_AREA_LIGHTS > 0 \) && defined\( RE_Direct_RectArea \)/

function buildCompatibleCsmLightsFragmentBegin(cascades: number): string {
  const directionalBlock = `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

  DirectionalLight directionalLight;
  float linearDepth = ( vViewPosition.z ) / ( shadowFar - cameraNear );
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow directionalLightShadow;
  #endif

  #if defined( USE_SHADOWMAP ) && defined( USE_CSM ) && defined( CSM_CASCADES ) && defined( CSM_FADE ) && CSM_FADE == 1
  vec2 cascade;
  float cascadeCenter;
  float closestEdge;
  float margin;
  float csmx;
  float csmy;
  #endif

  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

    directionalLight = directionalLights[ i ];

    getDirectionalLightInfo( directionalLight, directLight );

    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )

      #if defined( USE_CSM ) && defined( CSM_CASCADES )

        #if defined( CSM_FADE ) && CSM_FADE == 1 && ( UNROLLED_LOOP_INDEX < ${cascades} )

          cascade = CSM_cascades[ i ];
          cascadeCenter = ( cascade.x + cascade.y ) / 2.0;
          closestEdge = linearDepth < cascadeCenter ? cascade.x : cascade.y;
          margin = 0.25 * pow( closestEdge, 2.0 );
          csmx = cascade.x - margin / 2.0;
          csmy = cascade.y + margin / 2.0;
          if ( linearDepth >= csmx && ( linearDepth < csmy || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 ) ) {

            float dist = min( linearDepth - csmx, csmy - linearDepth );
            float ratio = clamp( dist / margin, 0.0, 1.0 );

            vec3 prevColor = directLight.color;
            directionalLightShadow = directionalLightShadows[ i ];
            directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

            bool shouldFadeLastCascade = UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth > cascadeCenter;
            directLight.color = mix( prevColor, directLight.color, shouldFadeLastCascade ? ratio : 1.0 );

            ReflectedLight prevLight = reflectedLight;
            RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

            bool shouldBlend = UNROLLED_LOOP_INDEX != CSM_CASCADES - 1 || ( UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 && linearDepth < cascadeCenter );
            float blendRatio = shouldBlend ? ratio : 1.0;

            reflectedLight.directDiffuse = mix( prevLight.directDiffuse, reflectedLight.directDiffuse, blendRatio );
            reflectedLight.directSpecular = mix( prevLight.directSpecular, reflectedLight.directSpecular, blendRatio );

          }

        #elif ( UNROLLED_LOOP_INDEX < ${cascades} )

          directionalLightShadow = directionalLightShadows[ i ];
          if ( linearDepth >= CSM_cascades[ UNROLLED_LOOP_INDEX ].x && linearDepth < CSM_cascades[ UNROLLED_LOOP_INDEX ].y ) directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

          if ( linearDepth >= CSM_cascades[ UNROLLED_LOOP_INDEX ].x && ( linearDepth < CSM_cascades[ UNROLLED_LOOP_INDEX ].y || UNROLLED_LOOP_INDEX == CSM_CASCADES - 1 ) ) RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

        #else

          directionalLightShadow = directionalLightShadows[ i ];
          directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

          RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

        #endif

      #else

        directionalLightShadow = directionalLightShadows[ i ];
        directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

      #endif

    #else

      RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

    #endif

  }
  #pragma unroll_loop_end

  #if defined( USE_CSM ) && defined( CSM_CASCADES ) && ( NUM_DIR_LIGHTS > NUM_DIR_LIGHT_SHADOWS )
    #pragma unroll_loop_start
    for ( int i = NUM_DIR_LIGHT_SHADOWS; i < NUM_DIR_LIGHTS; i ++ ) {

      directionalLight = directionalLights[ i ];
      getDirectionalLightInfo( directionalLight, directLight );
      RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

    }
    #pragma unroll_loop_end
  #endif

#endif`

  return baseThreeLightsFragmentBegin.replace(
    directionalLightsBlockPattern,
    `${directionalBlock}\n\n#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )`,
  )
}

function ensureThreeCsmShaderChunkCompatibility(cascades: number): void {
  THREE.ShaderChunk.lights_fragment_begin = buildCompatibleCsmLightsFragmentBegin(cascades)
}

type CsmCompatibleMaterial = THREE.Material & {
  isMeshLambertMaterial?: boolean
  isMeshPhongMaterial?: boolean
  isMeshStandardMaterial?: boolean
  isMeshPhysicalMaterial?: boolean
  isMeshToonMaterial?: boolean
}

function resolveSceneCsmConfig(config?: SceneCsmConfig | null): Required<SceneCsmConfig> {
  return {
    enabled: config?.enabled ?? DEFAULT_SCENE_CSM_CONFIG.enabled,
    shadowEnabled: config?.shadowEnabled ?? DEFAULT_SCENE_CSM_CONFIG.shadowEnabled,
    cascades: Math.max(1, Math.round(config?.cascades ?? DEFAULT_SCENE_CSM_CONFIG.cascades)),
    maxCascades: Math.max(
      1,
      Math.round(
        Math.max(
          config?.maxCascades ?? DEFAULT_SCENE_CSM_CONFIG.maxCascades,
          config?.cascades ?? DEFAULT_SCENE_CSM_CONFIG.cascades,
        ),
      ),
    ),
    maxFar: Math.max(1, Number(config?.maxFar ?? DEFAULT_SCENE_CSM_CONFIG.maxFar)),
    mode: (config?.mode ?? DEFAULT_SCENE_CSM_CONFIG.mode) as SceneCsmMode,
    practicalModeLambda: Number(config?.practicalModeLambda ?? DEFAULT_SCENE_CSM_CONFIG.practicalModeLambda),
    shadowMapSize: Math.max(128, Math.round(config?.shadowMapSize ?? DEFAULT_SCENE_CSM_CONFIG.shadowMapSize)),
    shadowBias: Number(config?.shadowBias ?? DEFAULT_SCENE_CSM_CONFIG.shadowBias),
    shadowNormalBias: Math.max(0, Number(config?.shadowNormalBias ?? DEFAULT_SCENE_CSM_CONFIG.shadowNormalBias)),
    lightMargin: Math.max(0, Number(config?.lightMargin ?? DEFAULT_SCENE_CSM_CONFIG.lightMargin)),
    fade: config?.fade ?? DEFAULT_SCENE_CSM_CONFIG.fade,
    noLastCascadeCutOff: config?.noLastCascadeCutOff ?? DEFAULT_SCENE_CSM_CONFIG.noLastCascadeCutOff,
    lightColor: config?.lightColor ?? DEFAULT_SCENE_CSM_CONFIG.lightColor,
    lightIntensity: Math.max(0, Number(config?.lightIntensity ?? DEFAULT_SCENE_CSM_CONFIG.lightIntensity)),
  }
}
export function isSceneCsmCompatibleMaterial(material: THREE.Material | null | undefined): material is CsmCompatibleMaterial {
  if (!material) {
    return false
  }
  const candidate = material as CsmCompatibleMaterial
  return Boolean(
    candidate.isMeshLambertMaterial
      || candidate.isMeshPhongMaterial
      || candidate.isMeshStandardMaterial
      || candidate.isMeshPhysicalMaterial
      || candidate.isMeshToonMaterial,
  )
}

export function forEachSceneCsmCompatibleMaterial(
  root: THREE.Object3D,
  visitor: (material: CsmCompatibleMaterial) => void,
): void {
  const visited = new Set<THREE.Material>()
  root.traverse((object) => {
    const materialCandidate = (object as THREE.Mesh).material
    if (!materialCandidate) {
      return
    }
    const materials = Array.isArray(materialCandidate) ? materialCandidate : [materialCandidate]
    materials.forEach((material) => {
      if (!isSceneCsmCompatibleMaterial(material) || visited.has(material)) {
        return
      }
      visited.add(material)
      visitor(material)
    })
  })
}

export class SceneCsmShadowRuntime {
  private readonly scene: THREE.Scene

  private readonly camera: THREE.PerspectiveCamera

  private readonly config: Required<SceneCsmConfig>

  private readonly csm: CSM | null

  private readonly registeredMaterials = new WeakSet<THREE.Material>()

  /**
   * The shader hook each registered material carried before three-csm wrapped it,
   * plus the wrapper three-csm installed.
   *
   * `CSM.dispose()` deletes `material.onBeforeCompile` outright instead of putting
   * back whatever `setupMaterial` wrapped. `onBeforeCompile` is a no-op on
   * `THREE.Material.prototype`, so that deletion does not throw — it silently
   * drops the injected look of every material that shades itself through the hook
   * ( the procedural city's road, crosswalk, sidewalk, kerb, streetlight and car
   * materials carry no map at all, so they render plain white afterwards; the
   * ground splat and landform feather hooks are lost the same way ). Snapshotting
   * the hook here lets {@link dispose} restore it.
   */
  private readonly materialShaderHooks = new Map<
    THREE.Material,
    {
      /** The hook the material owned before registration, if it had its own. */
      original: THREE.Material['onBeforeCompile'] | undefined
      /** The wrapper `CSM.setupMaterial` installed, used to prove ownership. */
      installed: THREE.Material['onBeforeCompile'] | undefined
    }
  >()

  private readonly lightColor = new THREE.Color()


  private readonly lastCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN)

  private readonly lastCameraQuaternion = new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN)

  private active = true

  private shadowEnabled = true

  private shadowsDirty = true

  private frustumsDirty = true


  private lastCameraProjectionState = {
    aspect: Number.NaN,
    far: Number.NaN,
    filmOffset: Number.NaN,
    focus: Number.NaN,
    fov: Number.NaN,
    near: Number.NaN,
    zoom: Number.NaN,
  }

  public constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    config?: SceneCsmConfig | null,
  ) {
    this.scene = scene
    this.camera = camera
    this.config = resolveSceneCsmConfig(config)
    this.lightColor.set(this.config.lightColor)
    this.shadowEnabled = this.config.shadowEnabled
    if (!this.config.enabled) {
      this.csm = null
      this.active = false
      return
    }
    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: this.config.cascades,
      maxCascades: this.config.maxCascades,
      maxFar: this.config.maxFar,
      mode: this.config.mode,
      practicalModeLambda: this.config.practicalModeLambda,
      shadowMapSize: this.config.shadowMapSize,
      shadowBias: this.config.shadowBias,
      shadowNormalBias: this.config.shadowNormalBias,
      lightDirection: defaultSunDirection.clone(),
      lightColor: this.lightColor.clone(),
      lightIntensity: this.config.lightIntensity,
      lightMargin: this.config.lightMargin,
      fade: this.config.fade,
      noLastCascadeCutOff: this.config.noLastCascadeCutOff,
    })
    ensureThreeCsmShaderChunkCompatibility(this.config.cascades)
  }

  private markShadowsDirty(): void {
    this.shadowsDirty = true
  }

  private markFrustumsDirty(): void {
    this.frustumsDirty = true
    this.shadowsDirty = true
  }

  private hasCameraTransformChanged(): boolean {
    return this.lastCameraPosition.distanceToSquared(this.camera.position) > cameraStateEpsilon
      || 1 - Math.abs(this.lastCameraQuaternion.dot(this.camera.quaternion)) > cameraStateEpsilon
  }

  private hasCameraProjectionChanged(): boolean {
    const last = this.lastCameraProjectionState
    return Math.abs(last.aspect - this.camera.aspect) > cameraStateEpsilon
      || Math.abs(last.far - this.camera.far) > cameraStateEpsilon
      || Math.abs(last.filmOffset - this.camera.filmOffset) > cameraStateEpsilon
      || Math.abs(last.focus - this.camera.focus) > cameraStateEpsilon
      || Math.abs(last.fov - this.camera.fov) > cameraStateEpsilon
      || Math.abs(last.near - this.camera.near) > cameraStateEpsilon
      || Math.abs(last.zoom - this.camera.zoom) > cameraStateEpsilon
  }

  private syncCameraStateSnapshot(): void {
    this.lastCameraPosition.copy(this.camera.position)
    this.lastCameraQuaternion.copy(this.camera.quaternion)
    this.lastCameraProjectionState.aspect = this.camera.aspect
    this.lastCameraProjectionState.far = this.camera.far
    this.lastCameraProjectionState.filmOffset = this.camera.filmOffset
    this.lastCameraProjectionState.focus = this.camera.focus
    this.lastCameraProjectionState.fov = this.camera.fov
    this.lastCameraProjectionState.near = this.camera.near
    this.lastCameraProjectionState.zoom = this.camera.zoom
  }

  public get enabled(): boolean {
    return Boolean(this.csm)
  }

  public registerMaterial(material: THREE.Material | null | undefined): void {
    if (!this.csm || !isSceneCsmCompatibleMaterial(material) || this.registeredMaterials.has(material)) {
      return
    }
    ensureThreeCsmShaderChunkCompatibility(this.config.cascades)
    // Capture the hook before three-csm wraps ( and later deletes ) it. A material
    // that never overrode the hook reads the prototype no-op here — remember that
    // it was not its own, so dispose can hand it back to the prototype instead of
    // freezing a copy onto the instance.
    const ownedHook = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')
      ? material.onBeforeCompile
      : undefined
    this.csm.setupMaterial(material)
    this.materialShaderHooks.set(material, {
      original: ownedHook,
      installed: material.onBeforeCompile,
    })
    this.registeredMaterials.add(material)
    this.markShadowsDirty()
  }

  public registerObject(root: THREE.Object3D | null | undefined): void {
    if (!this.csm || !root) {
      return
    }
    forEachSceneCsmCompatibleMaterial(root, (material) => {
      this.registerMaterial(material)
    })
    this.markShadowsDirty()
  }

  public setActive(active: boolean): void {
    const activeChanged = this.active !== active
    this.active = active
    if (!this.csm) {
      return
    }
    this.csm.lights.forEach((light) => {
      light.castShadow = active && this.shadowEnabled
      light.visible = active
      light.intensity = active ? this.csm!.lightIntensity : 0
    })
    if (activeChanged && active) {
      this.markShadowsDirty()
    }
  }

  public syncSun(position: THREE.Vector3, intensity: number, color?: THREE.ColorRepresentation): void {
    if (!this.csm) {
      return
    }
    tempSunDirection.copy(position)
    if (tempSunDirection.lengthSq() <= 1e-8) {
      tempSunDirection.copy(defaultSunDirection)
    } else {
      tempSunDirection.normalize().multiplyScalar(-1)
    }
    const resolvedIntensity = this.active ? Math.max(0, intensity) : 0
    this.csm.lightDirection.copy(tempSunDirection)
    this.csm.lightIntensity = resolvedIntensity
    if (color !== undefined) {
      this.lightColor.set(color)
      this.csm.lightColor.copy(this.lightColor)
    }
    this.csm.lights.forEach((light) => {
      light.color.copy(this.csm!.lightColor)
      light.intensity = this.csm!.lightIntensity
      light.castShadow = this.active && this.shadowEnabled
      light.visible = this.active
    })
    this.markShadowsDirty()

  }

  public update(): boolean {
    if (!this.csm || !this.active) {
      return false
    }
    // If shadow is disabled, skip shadow map update but keep light active
    if (!this.shadowEnabled) {
      this.syncCameraStateSnapshot()
      return false
    }
    const projectionChanged = this.frustumsDirty || this.hasCameraProjectionChanged()
    const transformChanged = projectionChanged || this.hasCameraTransformChanged()

    if (projectionChanged) {
      this.csm.updateFrustums()
      this.frustumsDirty = false
      this.shadowsDirty = true
    }

    if (!this.shadowsDirty && !transformChanged) {
      return false
    }

    this.csm.update()
    this.shadowsDirty = false
    this.syncCameraStateSnapshot()
    return true
  }

  public updateFrustums(): void {
    if (!this.csm) {
      return
    }
    this.markFrustumsDirty()
    this.csm.updateFrustums()
    this.frustumsDirty = false
    this.syncCameraStateSnapshot()
  }

  public dispose(): void {
    this.csm?.dispose()
    this.restoreMaterialShaderHooks()
  }

  /**
   * Puts back the `onBeforeCompile` every registered material carried before
   * three-csm wrapped it, undoing the `delete` buried in `CSM.dispose()`.
   *
   * Only hooks this runtime still owns are touched. Ownership is either the wrapper
   * three-csm installed ( still in place — for example when the material was
   * disposed before the runtime was ) or no own hook at all, which is exactly the
   * state that `delete material.onBeforeCompile` leaves behind. A material sporting
   * some other own hook belongs to a later owner and is left alone.
   */
  private restoreMaterialShaderHooks(): void {
    this.materialShaderHooks.forEach((entry, material) => {
      const hasOwnHook = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')
      const stillOurWrapper = material.onBeforeCompile === entry.installed
      if (!stillOurWrapper && !(entry.installed !== undefined && hasOwnHook === false)) {
        return
      }
      if (entry.original !== undefined) {
        material.onBeforeCompile = entry.original
      } else if (hasOwnHook) {
        delete (material as { onBeforeCompile?: THREE.Material['onBeforeCompile'] }).onBeforeCompile
      } else {
        // the material never owned a hook and has none now — nothing to restore
        return
      }
      material.needsUpdate = true
    })
    this.materialShaderHooks.clear()
  }
}

export function createSceneCsmShadowRuntime(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  config?: SceneCsmConfig | null,
): SceneCsmShadowRuntime {
  return new SceneCsmShadowRuntime(scene, camera, config)
}
