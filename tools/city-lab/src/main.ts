/**
 * City Lab — builds the r180 skyscraper geometry on the CPU and dresses it in the
 * engine's own WebGL city material, to prove the geometry half of three's r180
 * `CityGenerator` runs without its TSL / WebGPU material half.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
	buildProceduralCityBlockGroup,
	disposeProceduralCityBlockGroup,
	type ProceduralCityBlockGroupUserData,
	type ProceduralCityTowerBox
} from '@schema/components/definitions/proceduralCityBlock'
import { pickBuildingColor } from '@schema/components/definitions/proceduralCitySkyscraper'
import { getWallMaterial } from '@schema/components/definitions/proceduralCityMaterials'
import { applySkyscraperPartColors } from '@schema/components/definitions/proceduralCityPartColors'
import { CITY_LAB_DEFAULT_SETTINGS, createCityLabUi, type CityLabSettings } from './ui'
import './style.css'

function requireElement< T extends Element >( selector: string ): T {

	const found = document.querySelector< T >( selector )
	if ( found === null ) throw new Error( `city-lab: ${selector} is missing` )
	return found

}

const canvas = requireElement< HTMLCanvasElement >( '#viewport' )

const renderer = new THREE.WebGLRenderer( { canvas, antialias: true } )
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
renderer.setClearColor( 0x11151c, 1 )
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera( 50, 1, 0.5, 5000 )
camera.position.set( 180, 160, 220 )

const controls = new OrbitControls( camera, canvas )
controls.enableDamping = true
controls.dampingFactor = 0.08

// the ground stands in for the road the towers front onto — the sidewalk, road
// marking and street furniture generators stay out of this round
const ground = new THREE.Mesh(
	new THREE.PlaneGeometry( 1, 1 ),
	new THREE.MeshStandardMaterial( { color: 0x2b3035, roughness: 0.95, metalness: 0 } )
)
ground.rotation.x = - Math.PI / 2
// just under the city's own road surface, so the two never z-fight
ground.position.y = - 0.05
ground.receiveShadow = true
scene.add( ground )

const grid = new THREE.GridHelper( 100, 50, 0x3a444f, 0x252b33 )
scene.add( grid )

const hemisphere = new THREE.HemisphereLight( 0xdfe8ff, 0x33322e, 1.1 )
const sun = new THREE.DirectionalLight( 0xfff0d4, 2.2 )
sun.castShadow = true
sun.shadow.mapSize.set( 2048, 2048 )
sun.shadow.bias = - 0.0008
scene.add( hemisphere, sun, sun.target )

// one shared, cached material — the exact instance the procedural city component uses
const wallMaterial = getWallMaterial( 'solid' )

const settings: CityLabSettings = { ...CITY_LAB_DEFAULT_SETTINGS }

let city: THREE.Group | null = null
let buildMs = 0
let towerCount = 0
let streetlightCount = 0
let carCount = 0
let vertexCount = 0
let frameMs = 0
let lastStatsAt = 0

const ui = createCityLabUi( {
	settings,
	onChange: ( next, changed ) => {

		Object.assign( settings, next )

		// neither of these changes the geometry
		if ( changed === 'shadows' ) {
			applyShadowSettings()
			return
		}
		if ( changed === 'showStats' ) {
			lastStatsAt = 0
			return
		}

		rebuild()

	}
} )

function applyShadowSettings(): void {

	sun.castShadow = settings.shadows
	ground.receiveShadow = settings.shadows

	// the shader permutation depends on how many lights cast shadows, so the wall
	// material has to be recompiled when that set changes
	wallMaterial.needsUpdate = true
	ground.material.needsUpdate = true

}

function rebuild(): void {

	ui.setStatus( 'building…' )
	const startedAt = performance.now()

	if ( city !== null ) {

		scene.remove( city )
		disposeProceduralCityBlockGroup( city )
		city = null

	}

	const group = buildProceduralCityBlockGroup( {
		seed: settings.seed,
		blocksX: settings.blocksX,
		blocksZ: settings.blocksZ,
		lotsX: settings.lotsX,
		lotsZ: settings.lotsZ,
		minTowerHeight: settings.minTowerHeight,
		maxTowerHeight: settings.maxTowerHeight,
		includeRoad: settings.road,
		includeSidewalks: settings.sidewalks,
		includeStreetlights: settings.streetlights,
		includeCars: settings.cars,
		material: wallMaterial
	} )

	const userData = group.userData as ProceduralCityBlockGroupUserData
	const debugColors = settings.materialMode === 'part-debug'
	let vertices = 0

	group.children.forEach( ( child ) => {

		const mesh = child as THREE.Mesh< THREE.BufferGeometry, THREE.Material >
		const tower = child.userData.tower as ProceduralCityTowerBox | undefined
		if ( tower === undefined ) return

		// the per-tower palette colour, keyed off the tower's own generator seed
		applySkyscraperPartColors( mesh.geometry, new THREE.Color( pickBuildingColor( tower.seed ) ), debugColors ? 'debug' : 'project' )
		vertices += mesh.geometry.getAttribute( 'position' ).count

	} )

	scene.add( group )
	city = group
	towerCount = userData.towers.length
	streetlightCount = userData.streetlights
	carCount = userData.cars
	vertexCount = vertices
	buildMs = performance.now() - startedAt

	applyShadowSettings()
	frameCity( group )
	lastStatsAt = 0
	ui.setStatus( `${towerCount} towers · seed ${settings.seed}` )

}

function frameCity( group: THREE.Group ): void {

	const box = new THREE.Box3().setFromObject( group )
	const size = box.getSize( new THREE.Vector3() )
	const center = box.getCenter( new THREE.Vector3() )
	const radius = Math.max( size.x, size.z, size.y, 1 )

	camera.position.set( center.x + radius * 0.95, center.y + radius * 0.68, center.z + radius * 1.2 )
	camera.near = Math.max( 0.2, radius / 500 )
	camera.far = radius * 30
	camera.updateProjectionMatrix()

	controls.target.copy( center )
	controls.minDistance = radius * 0.05
	controls.maxDistance = radius * 6
	controls.update()

	const groundSize = radius * 3
	ground.scale.set( groundSize, groundSize, 1 )
	grid.scale.setScalar( groundSize / 100 )

	const sunDirection = new THREE.Vector3( 0.55, 0.75, 0.4 ).normalize()
	sun.position.copy( center ).addScaledVector( sunDirection, radius * 2 )
	sun.target.position.copy( center )
	sun.target.updateMatrixWorld()

	const shadowCamera = sun.shadow.camera
	const extent = radius * 0.8
	shadowCamera.left = - extent
	shadowCamera.right = extent
	shadowCamera.top = extent
	shadowCamera.bottom = - extent
	shadowCamera.near = radius * 0.1
	shadowCamera.far = radius * 6
	shadowCamera.updateProjectionMatrix()

}

function resizeToDisplay(): void {

	const width = canvas.clientWidth
	const height = canvas.clientHeight
	if ( width === 0 || height === 0 ) return
	if ( canvas.width === width && canvas.height === height ) return

	renderer.setSize( width, height, false )
	camera.aspect = width / height
	camera.updateProjectionMatrix()

}

function refreshStats(): void {

	const now = performance.now()
	if ( now - lastStatsAt < 250 ) return
	lastStatsAt = now

	ui.setStats( {
		towers: towerCount,
		streetlights: streetlightCount,
		cars: carCount,
		vertices: vertexCount,
		// the merged tower geometry is non-indexed, so vertices / 3 is its triangle count
		geometryTriangles: vertexCount / 3,
		triangles: renderer.info.render.triangles,
		drawCalls: renderer.info.render.calls,
		buildMs,
		frameMs
	} )

}

const timer = new THREE.Timer()

function animate(): void {

	timer.update()
	frameMs = frameMs * 0.9 + timer.getDelta() * 1000 * 0.1

	resizeToDisplay()
	controls.update()
	renderer.render( scene, camera )
	refreshStats()

	requestAnimationFrame( animate )

}

rebuild()
animate()

// a hook so the console ( or a headless check ) can drive the lab without the panel
Object.assign( window, { __cityLab: { camera, controls, settings, rebuild, scene, renderer } } )
