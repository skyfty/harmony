import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

import type { LightNodeProperties } from './index'

let rectAreaLightSupportInitialized = false

export function ensureRectAreaLightSupport(): void {
  if (rectAreaLightSupportInitialized) {
    return
  }
  RectAreaLightUniformsLib.init()
  rectAreaLightSupportInitialized = true
}

export type CreatedThreeLight = {
  light: THREE.Light
  /** Optional target for Directional/Spot lights. Added by caller to the scene/root. */
  target?: THREE.Object3D
}

export function createThreeLightFromLightNode(props: LightNodeProperties): CreatedThreeLight {
  const color = new THREE.Color(props.color ?? '#ffffff')
  const intensity = Number.isFinite(props.intensity) ? Number(props.intensity) : 1

  switch (props.type) {
    case 'Directional': {
      const directional = new THREE.DirectionalLight(color, intensity)
      directional.castShadow = Boolean(props.castShadow)
      directional.shadow.mapSize.set(2048, 2048)
      directional.shadow.camera.near = 0.1
      directional.shadow.camera.far = 200
      directional.shadow.bias = -0.0002

      if (props.target) {
        const target = new THREE.Object3D()
        target.position.set(props.target.x, props.target.y, props.target.z)
        directional.target = target
        return { light: directional, target }
      }

      return { light: directional }
    }

    case 'Point': {
      const point = new THREE.PointLight(color, intensity, props.distance ?? 0, props.decay ?? 1)
      point.castShadow = Boolean(props.castShadow)
      return { light: point }
    }

    case 'Spot': {
      const spot = new THREE.SpotLight(
        color,
        intensity,
        props.distance ?? 0,
        props.angle ?? Math.PI / 4,
        props.penumbra ?? 0,
        props.decay ?? 1,
      )
      spot.castShadow = Boolean(props.castShadow)
      spot.shadow.mapSize.set(1024, 1024)

      if (props.target) {
        const target = new THREE.Object3D()
        target.position.set(props.target.x, props.target.y, props.target.z)
        spot.target = target
        return { light: spot, target }
      }

      return { light: spot }
    }

    case 'Hemisphere': {
      const ground = new THREE.Color(props.groundColor ?? '#444444')
      const hemi = new THREE.HemisphereLight(color, ground, intensity)
      return { light: hemi }
    }

    case 'RectArea': {
      ensureRectAreaLightSupport()
      const width = Number.isFinite(props.width) ? Math.max(0, Number(props.width)) : 10
      const height = Number.isFinite(props.height) ? Math.max(0, Number(props.height)) : 10
      const rect = new THREE.RectAreaLight(color, intensity, width, height)
      return { light: rect }
    }

    case 'Ambient':
    default: {
      const ambient = new THREE.AmbientLight(color, intensity)
      return { light: ambient }
    }
  }
}
