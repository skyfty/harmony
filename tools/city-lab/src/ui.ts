/**
 * The lab's parameter panel and readouts. Kept dependency-free ( plain DOM ) so
 * the tool adds nothing to the workspace's dependency graph.
 */

export type CityLabMaterialMode = 'project' | 'part-debug'

export type CityLabBuildingPreset = 'skyscraper' | 'solid' | 'office' | 'bright' | 'classic' | 'warm' | 'cool'

export type CityLabSettings = {
	seed: number
	buildingPreset: CityLabBuildingPreset
	blocksX: number
	blocksZ: number
	lotsX: number
	lotsZ: number
	minTowerHeight: number
	maxTowerHeight: number
	/** Keep the middle of the grid free of towers for a hand-placed theme building. */
	reserveEnabled: boolean
	/** 0 = the reserved block's own size. */
	reserveWidth: number
	reserveDepth: number
	/** How many blocks the reserved block moves off the nearest-to-centre block. */
	reserveBlockX: number
	reserveBlockZ: number
	materialMode: CityLabMaterialMode
	road: boolean
	sidewalks: boolean
	streetlights: boolean
	cars: boolean
	/** How much of the walk's streetlight / car layout to keep, as a percentage. */
	streetlightDensity: number
	carDensity: number
	shadows: boolean
	showStats: boolean
}

export type CityLabStats = {
	towers: number
	/** Towers the reserve rectangle dropped before they were generated. */
	reservedTowers: number
	streetlights: number
	cars: number
	vertices: number
	geometryTriangles: number
	triangles: number
	drawCalls: number
	buildMs: number
	frameMs: number
}

/** Upstream `CityGenerator.defaults` ( 2 × 2 blocks of 3 × 2 lots = 24 towers ). */
export const CITY_LAB_DEFAULT_SETTINGS: CityLabSettings = {
	seed: 1,
	buildingPreset: 'solid',
	blocksX: 2,
	blocksZ: 2,
	lotsX: 3,
	lotsZ: 2,
	minTowerHeight: 38,
	maxTowerHeight: 152,
	reserveEnabled: false,
	reserveWidth: 0,
	reserveDepth: 0,
	reserveBlockX: 0,
	reserveBlockZ: 0,
	materialMode: 'project',
	road: true,
	sidewalks: true,
	streetlights: true,
	cars: true,
	streetlightDensity: 100,
	carDensity: 100,
	shadows: true,
	showStats: true
}

type UiOptions = {
	settings: CityLabSettings
	onChange: ( settings: CityLabSettings, changed: keyof CityLabSettings ) => void
}

type UiHandle = {
	setStats: ( stats: CityLabStats ) => void
	setStatus: ( text: string ) => void
}

// the cheap presets only carry a few thousand vertices, so keep the exact count
// until it is large enough for megas to read better
function formatCount( value: number ): string {

	if ( value < 100000 ) return Math.round( value ).toLocaleString( 'en-US' )
	return `${( value / 1e6 ).toFixed( 2 )} M`

}

function element< T extends HTMLElement >( tag: string, className?: string, text?: string ): T {

	const node = document.createElement( tag ) as T
	if ( className !== undefined ) node.className = className
	if ( text !== undefined ) node.textContent = text
	return node

}

function requireElement< T extends Element >( selector: string ): T {

	const found = document.querySelector< T >( selector )
	if ( found === null ) throw new Error( `city-lab: ${selector} is missing` )
	return found

}

export function createCityLabUi( options: UiOptions ): UiHandle {

	const panel = requireElement< HTMLElement >( '#panel' )
	const statsHost = requireElement< HTMLElement >( '#stats' )
	const statusHost = requireElement< HTMLElement >( '#status' )

	const settings: CityLabSettings = { ...options.settings }
	const update = ( changed: keyof CityLabSettings ): void => options.onChange( { ...settings }, changed )

	// one entry per control: writes the current settings back into its DOM node, so
	// "reset" can restore every widget from one place
	const syncControls: ( () => void )[] = []

	function addSlider(
		key:
			| 'blocksX'
			| 'blocksZ'
			| 'lotsX'
			| 'lotsZ'
			| 'minTowerHeight'
			| 'maxTowerHeight'
			| 'reserveWidth'
			| 'reserveDepth'
			| 'reserveBlockX'
			| 'reserveBlockZ'
			| 'streetlightDensity'
			| 'carDensity',
		label: string,
		min: number,
		max: number,
		step: number
	): void {

		const row = element( 'label', 'row row-slider' )
		row.append( element( 'span', 'row-label', label ) )

		const value = element( 'span', 'row-value', String( settings[ key ] ) )
		const input = element< HTMLInputElement >( 'input' )
		input.type = 'range'
		input.min = String( min )
		input.max = String( max )
		input.step = String( step )
		input.value = String( settings[ key ] )
		input.addEventListener( 'input', () => {
			settings[ key ] = Number( input.value )
			value.textContent = input.value
			update( key )
		} )

		row.append( input, value )
		panel.append( row )

		syncControls.push( () => {
			input.value = String( settings[ key ] )
			value.textContent = input.value
		} )

	}

	panel.append( element( 'h1', 'panel-title', 'City Lab' ) )
	panel.append( element( 'p', 'panel-note', 'three r180 skyscraper geometry ( CPU ) + engine WebGL city material' ) )

	// seed
	const seedRow = element( 'label', 'row' )
	seedRow.append( element( 'span', 'row-label', 'seed' ) )
	const seedInput = element< HTMLInputElement >( 'input' )
	seedInput.type = 'number'
	seedInput.min = '0'
	seedInput.step = '1'
	seedInput.value = String( settings.seed )
	seedInput.addEventListener( 'change', () => {
		settings.seed = Number.isFinite( Number( seedInput.value ) ) ? Math.max( 0, Math.trunc( Number( seedInput.value ) ) ) : settings.seed
		seedInput.value = String( settings.seed )
		update( 'seed' )
	} )
	seedRow.append( seedInput )
	panel.append( seedRow )
	syncControls.push( () => {
		seedInput.value = String( settings.seed )
	} )

	// building preset
	const buildingRow = element( 'label', 'row' )
	buildingRow.append( element( 'span', 'row-label', 'building' ) )
	const buildingSelect = element< HTMLSelectElement >( 'select' )
	for ( const value of [ 'skyscraper', 'solid', 'office', 'bright', 'classic', 'warm', 'cool' ] as const ) {
		const option = element< HTMLOptionElement >( 'option' )
		option.value = value
		option.textContent = value === 'skyscraper' ? 'skyscraper (detailed)' : `${value} (instanced)`
		buildingSelect.append( option )
	}
	buildingSelect.value = settings.buildingPreset
	buildingSelect.addEventListener( 'change', () => {
		settings.buildingPreset = buildingSelect.value as CityLabBuildingPreset
		update( 'buildingPreset' )
	} )
	buildingRow.append( buildingSelect )
	panel.append( buildingRow )
	syncControls.push( () => {
		buildingSelect.value = settings.buildingPreset
	} )

	addSlider( 'blocksX', 'blocks X', 1, 3, 1 )
	addSlider( 'blocksZ', 'blocks Z', 1, 3, 1 )
	addSlider( 'lotsX', 'lots X', 1, 3, 1 )
	addSlider( 'lotsZ', 'lots Z', 1, 3, 1 )
	addSlider( 'minTowerHeight', 'min height', 1, 200, 1 )
	addSlider( 'maxTowerHeight', 'max height', 1, 260, 1 )

	// the reserved block: one whole block no tower may stand in, so the city can hold a
	// hand-placed theme building where a procedural block would have been
	addSlider( 'reserveWidth', 'reserve width', 0, 200, 1 )
	addSlider( 'reserveDepth', 'reserve depth', 0, 200, 1 )
	addSlider( 'reserveBlockX', 'reserve block X', - 3, 3, 1 )
	addSlider( 'reserveBlockZ', 'reserve block Z', - 3, 3, 1 )

	// how much of the kerbside furniture survives the walk — the same thinning the
	// city generator component's density props apply, so the lab can be dialled down
	// to a street the editor can be dialled down to
	addSlider( 'streetlightDensity', 'streetlight %', 0, 100, 5 )
	addSlider( 'carDensity', 'car %', 0, 100, 5 )

	// material mode
	const modeRow = element( 'label', 'row' )
	modeRow.append( element( 'span', 'row-label', 'material' ) )
	const modeSelect = element< HTMLSelectElement >( 'select' )
	for ( const [ value, label ] of [ [ 'project', 'engine solid' ], [ 'part-debug', 'partId debug' ] ] as const ) {
		const option = element< HTMLOptionElement >( 'option' )
		option.value = value
		option.textContent = label
		modeSelect.append( option )
	}
	modeSelect.value = settings.materialMode
	modeSelect.addEventListener( 'change', () => {
		settings.materialMode = modeSelect.value === 'part-debug' ? 'part-debug' : 'project'
		update( 'materialMode' )
	} )
	modeRow.append( modeSelect )
	panel.append( modeRow )
	syncControls.push( () => {
		modeSelect.value = settings.materialMode
	} )

	// toggles
	const toggleLabels = { reserveEnabled: 'reserve', road: 'road', sidewalks: 'sidewalks', streetlights: 'streetlights', cars: 'cars', shadows: 'shadows', showStats: 'stats' } as const
	for ( const key of [ 'reserveEnabled', 'road', 'sidewalks', 'streetlights', 'cars', 'shadows', 'showStats' ] as const ) {

		const row = element( 'label', 'row row-toggle' )
		row.append( element( 'span', 'row-label', toggleLabels[ key ] ) )
		const input = element< HTMLInputElement >( 'input' )
		input.type = 'checkbox'
		input.checked = settings[ key ]
		input.addEventListener( 'change', () => {
			settings[ key ] = input.checked
			update( key )
		} )
		row.append( input )
		panel.append( row )

		syncControls.push( () => {
			input.checked = settings[ key ]
		} )

	}

	// reset
	const reset = element< HTMLButtonElement >( 'button', 'reset-button', 'reset' )
	reset.addEventListener( 'click', () => {
		Object.assign( settings, CITY_LAB_DEFAULT_SETTINGS )
		for ( const sync of syncControls ) sync()
		update( 'seed' )
	} )
	panel.append( reset )

	return { setStats, setStatus }

	function setStatus( text: string ): void {

		statusHost.textContent = text

	}

	function setStats( stats: CityLabStats ): void {

		statsHost.hidden = ! settings.showStats
		if ( statsHost.hidden ) return

		const rows: [ string, string ][] = [
			[ 'towers', String( stats.towers ) ],
			[ 'reserved', String( stats.reservedTowers ) ],
			[ 'streetlights', String( stats.streetlights ) ],
			[ 'cars', String( stats.cars ) ],
			[ 'vertices', formatCount( stats.vertices ) ],
			[ 'tris (geometry)', formatCount( stats.geometryTriangles ) ],
			[ 'tris / frame', formatCount( stats.triangles ) ],
			[ 'draw calls / frame', String( stats.drawCalls ) ],
			[ 'geometry build', `${stats.buildMs.toFixed( 0 )} ms` ],
			[ 'frame', `${stats.frameMs.toFixed( 1 )} ms` ]
		]

		statsHost.replaceChildren( ...rows.map( ( [ label, value ] ) => {
			const row = element( 'div', 'stat-row' )
			row.append( element( 'span', 'stat-label', label ), element( 'span', 'stat-value', value ) )
			return row
		} ) )

	}

}
