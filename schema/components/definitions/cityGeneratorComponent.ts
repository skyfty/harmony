/**
 * A self-contained procedural city: the three r180 block generator ( skyscraper
 * geometry, road with lane markings and crosswalks, raised sidewalks, cobra-head
 * streetlights and a parked car fleet ), built on the CPU and dressed in the
 * engine's WebGL city materials.
 *
 * Unlike `proceduralCity`, which fills an attached Floor / Region / Road /
 * Landform footprint, this component ignores the host's shape and builds a
 * rectangular block grid centred on the node it is attached to — the same way the
 * upstream `CityGenerator` lays a city out.
 */

import * as THREE from 'three'
import type { Object3D } from 'three'

import { Component, type ComponentRuntimeContext } from '../Component'
import {
	COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
	COMPONENT_ARTIFACT_KEY,
	COMPONENT_ARTIFACT_NODE_ID_KEY,
	componentManager,
	type ComponentDefinition
} from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import {
	buildProceduralCityBlockGroup,
	disposeProceduralCityBlockGroup,
	type ProceduralCityBlockGroupUserData,
	type ProceduralCityTowerBox
} from './proceduralCityBlock'
import { pickBuildingColor } from './proceduralCitySkyscraper'
import { getWallMaterial } from './proceduralCityMaterials'
import { applySkyscraperPartColors } from './proceduralCityPartColors'

export const CITY_GENERATOR_COMPONENT_TYPE = 'cityGenerator'

const CITY_GENERATOR_RUNTIME_GROUP_KEY = '__harmonyCityGeneratorRuntimeGroup'

export interface CityGeneratorComponentProps {
	seed: number
	/** Lot ( block cell ) size in metres; a block is `lot × lots`. */
	lot: number
	lotsX: number
	lotsZ: number
	blocksX: number
	blocksZ: number
	/** Street width between blocks. */
	streetWidth: number
	/** Walking strip between the street wall and the curb. */
	sidewalkWidth: number
	curbHeight: number
	curbRadius: number
	minTowerHeight: number
	maxTowerHeight: number
	includeRoad: boolean
	includeSidewalks: boolean
	includeStreetlights: boolean
	includeCars: boolean
}

// the upstream `CityGenerator.defaults` grid, which is also the city-lab default
export const CITY_GENERATOR_DEFAULT_PROPS: CityGeneratorComponentProps = {
	seed: 1,
	lot: 30,
	lotsX: 3,
	lotsZ: 2,
	blocksX: 2,
	blocksZ: 2,
	streetWidth: 22,
	sidewalkWidth: 5,
	curbHeight: 0.15,
	curbRadius: 5,
	minTowerHeight: 38,
	maxTowerHeight: 152,
	includeRoad: true,
	includeSidewalks: true,
	includeStreetlights: true,
	includeCars: true
}

function finiteNumber(value: unknown, fallback: number): number {
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, finiteNumber(value, fallback)))
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	return Math.round(clampNumber(value, fallback, min, max))
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback
}

/**
 * Clamps the props to ranges a single component can actually carry: one tower is
 * ~50k vertices, so the lot and block counts are the two that have to stay
 * bounded ( the defaults build 24 towers / ~1.2M vertices ).
 */
export function clampCityGeneratorComponentProps(props?: Partial<CityGeneratorComponentProps> | null): CityGeneratorComponentProps {
	const source = props ?? {}
	const minTowerHeight = clampNumber(source.minTowerHeight, CITY_GENERATOR_DEFAULT_PROPS.minTowerHeight, 6, 400)
	const maxTowerHeight = Math.max(
		minTowerHeight,
		clampNumber(source.maxTowerHeight, CITY_GENERATOR_DEFAULT_PROPS.maxTowerHeight, 6, 400),
	)

	return {
		seed: clampInteger(source.seed, CITY_GENERATOR_DEFAULT_PROPS.seed, 0, 999999),
		lot: clampNumber(source.lot, CITY_GENERATOR_DEFAULT_PROPS.lot, 8, 90),
		lotsX: clampInteger(source.lotsX, CITY_GENERATOR_DEFAULT_PROPS.lotsX, 1, 3),
		lotsZ: clampInteger(source.lotsZ, CITY_GENERATOR_DEFAULT_PROPS.lotsZ, 1, 3),
		blocksX: clampInteger(source.blocksX, CITY_GENERATOR_DEFAULT_PROPS.blocksX, 1, 3),
		blocksZ: clampInteger(source.blocksZ, CITY_GENERATOR_DEFAULT_PROPS.blocksZ, 1, 3),
		streetWidth: clampNumber(source.streetWidth, CITY_GENERATOR_DEFAULT_PROPS.streetWidth, 6, 60),
		sidewalkWidth: clampNumber(source.sidewalkWidth, CITY_GENERATOR_DEFAULT_PROPS.sidewalkWidth, 1, 15),
		curbHeight: clampNumber(source.curbHeight, CITY_GENERATOR_DEFAULT_PROPS.curbHeight, 0, 1.5),
		curbRadius: clampNumber(source.curbRadius, CITY_GENERATOR_DEFAULT_PROPS.curbRadius, 0, 30),
		minTowerHeight,
		maxTowerHeight,
		includeRoad: clampBoolean(source.includeRoad, CITY_GENERATOR_DEFAULT_PROPS.includeRoad),
		includeSidewalks: clampBoolean(source.includeSidewalks, CITY_GENERATOR_DEFAULT_PROPS.includeSidewalks),
		includeStreetlights: clampBoolean(source.includeStreetlights, CITY_GENERATOR_DEFAULT_PROPS.includeStreetlights),
		includeCars: clampBoolean(source.includeCars, CITY_GENERATOR_DEFAULT_PROPS.includeCars)
	}
}

export function cloneCityGeneratorComponentProps(props?: Partial<CityGeneratorComponentProps> | null): CityGeneratorComponentProps {
	return { ...clampCityGeneratorComponentProps(props) }
}

/** How many towers the current grid will build. */
export function countCityGeneratorTowers(props: CityGeneratorComponentProps): number {
	return props.blocksX * props.blocksZ * props.lotsX * props.lotsZ
}

function tagCityGeneratorArtifact(object: Object3D, nodeId: string, componentId: string): void {
	object.traverse((child) => {
		child.userData = child.userData ?? {}
		child.userData[COMPONENT_ARTIFACT_KEY] = true
		child.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = nodeId
		child.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = componentId
	})
}

class CityGeneratorComponent extends Component<CityGeneratorComponentProps> {
	private cityObject: THREE.Group | null = null

	constructor(context: ComponentRuntimeContext<CityGeneratorComponentProps>) {
		super(context)
	}

	onInit(): void {
		this.rebuild()
	}

	onRuntimeAttached(_object: Object3D | null): void {
		this.rebuild()
	}

	onPropsUpdated(): void {
		this.rebuild()
	}

	onEnabledChanged(enabled: boolean): void {
		if (enabled) {
			this.rebuild()
		} else {
			this.clear()
		}
	}

	onDestroy(): void {
		this.clear()
	}

	private clear(): void {
		const host = this.context.getRuntimeObject()
		const stored = host?.userData?.[CITY_GENERATOR_RUNTIME_GROUP_KEY] as THREE.Object3D | null | undefined
		const target = stored ?? this.cityObject

		if (target) {
			target.parent?.remove(target)
			disposeProceduralCityBlockGroup(target as THREE.Group)
		}
		if (host?.userData) {
			delete host.userData[CITY_GENERATOR_RUNTIME_GROUP_KEY]
		}

		this.cityObject = null
	}

	private rebuild(): void {
		const host = this.context.getRuntimeObject()
		this.clear()
		if (!this.context.isEnabled() || !host) {
			return
		}

		const props = clampCityGeneratorComponentProps(this.context.getProps())

		const group = buildProceduralCityBlockGroup({
			seed: props.seed,
			lot: props.lot,
			lotsX: props.lotsX,
			lotsZ: props.lotsZ,
			blocksX: props.blocksX,
			blocksZ: props.blocksZ,
			street: props.streetWidth,
			sidewalkWidth: props.sidewalkWidth,
			minTowerHeight: props.minTowerHeight,
			maxTowerHeight: props.maxTowerHeight,
			includeRoad: props.includeRoad,
			includeSidewalks: props.includeSidewalks,
			includeStreetlights: props.includeStreetlights,
			includeCars: props.includeCars,
			sidewalk: { curbHeight: props.curbHeight, curbRadius: props.curbRadius },
			// the engine's own city wall material: vertex colours plus its baked
			// directional light, the same instance the procedural city uses
			material: getWallMaterial('solid')
		})
		group.name = 'CityGenerator'

		// the r180 generators tag each zone with a partId; the wall material reads
		// a per-vertex colour instead, so bake the palette into the towers
		for (const child of group.children) {
			const tower = child.userData.tower as ProceduralCityTowerBox | undefined
			if (!tower) {
				continue
			}
			const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
			applySkyscraperPartColors(mesh.geometry, new THREE.Color(pickBuildingColor(tower.seed)), 'project')
		}

		tagCityGeneratorArtifact(group, this.context.nodeId, this.context.componentId)

		host.add(group)
		const userData = host.userData ?? (host.userData = {})
		userData[CITY_GENERATOR_RUNTIME_GROUP_KEY] = group
		this.cityObject = group
	}
}

const cityGeneratorComponentDefinition: ComponentDefinition<CityGeneratorComponentProps> = {
	type: CITY_GENERATOR_COMPONENT_TYPE,
	label: 'City Generator',
	icon: 'mdi-city-variant',
	order: 55,
	recreateOnPropsChange: false,
	canAttach(node: SceneNode) {
		const nodeType = node.nodeType?.toLowerCase?.() ?? ''
		return nodeType !== 'light' && nodeType !== 'environment'
	},
	createDefaultProps() {
		return cloneCityGeneratorComponentProps(CITY_GENERATOR_DEFAULT_PROPS)
	},
	createInstance(context) {
		return new CityGeneratorComponent(context)
	},
}

componentManager.registerDefinition(cityGeneratorComponentDefinition)

export function createCityGeneratorComponentState(
	overrides?: Partial<CityGeneratorComponentProps>,
	options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<CityGeneratorComponentProps> {
	return {
		id: options.id ?? '',
		type: CITY_GENERATOR_COMPONENT_TYPE,
		enabled: options.enabled ?? true,
		props: clampCityGeneratorComponentProps({
			...CITY_GENERATOR_DEFAULT_PROPS,
			...overrides,
		}),
	}
}

export { cityGeneratorComponentDefinition }

/** The tower and furniture counts a built city reported, for callers that inspect the runtime. */
export type CityGeneratorRuntimeStats = Pick<ProceduralCityBlockGroupUserData, 'towers' | 'streetlights' | 'cars' | 'seed'>
