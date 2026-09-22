/**
 * The lab's parameter panel and readouts. Kept dependency-free ( plain DOM ) so
 * the tool adds nothing to the workspace's dependency graph.
 */

export type CityLabMaterialMode = 'project' | 'part-debug'

export type CityLabSettings = {
	seed: number
	blocksX: number
	blocksZ: number
	lotsX: number
	lotsZ: number
	minTowerHeight: number
	maxTowerHeight: number
	materialMode: CityLabMaterialMode
	road: boolean
	sidewalks: boolean
	streetlights: boolean
	cars: boolean
	shadows: boolean
	showStats: boolean
}

export type CityLabStats = {
	towers: number
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
	blocksX: 2,
	blocksZ: 2,
	lotsX: 3,
	lotsZ: 2,
	minTowerHeight: 38,
	maxTowerHeight: 152,
	materialMode: 'project',
	road: true,
	sidewalks: true,
	streetlights: true,
	cars: true,
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

function formatMegas( value: number ): string {
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
		key: 'blocksX' | 'blocksZ' | 'lotsX' | 'lotsZ' | 'minTowerHeight' | 'maxTowerHeight',
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

	addSlider( 'blocksX', 'blocks X', 1, 3, 1 )
	addSlider( 'blocksZ', 'blocks Z', 1, 3, 1 )
	addSlider( 'lotsX', 'lots X', 1, 3, 1 )
	addSlider( 'lotsZ', 'lots Z', 1, 3, 1 )
	addSlider( 'minTowerHeight', 'min height', 20, 200, 2 )
	addSlider( 'maxTowerHeight', 'max height', 20, 260, 2 )

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
	const toggleLabels = { road: 'road', sidewalks: 'sidewalks', streetlights: 'streetlights', cars: 'cars', shadows: 'shadows', showStats: 'stats' } as const
	for ( const key of [ 'road', 'sidewalks', 'streetlights', 'cars', 'shadows', 'showStats' ] as const ) {

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
			[ 'streetlights', String( stats.streetlights ) ],
			[ 'cars', String( stats.cars ) ],
			[ 'vertices', formatMegas( stats.vertices ) ],
			[ 'tris (geometry)', formatMegas( stats.geometryTriangles ) ],
			[ 'tris / frame', formatMegas( stats.triangles ) ],
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
