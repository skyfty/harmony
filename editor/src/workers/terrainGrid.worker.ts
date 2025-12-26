/// <reference lib="webworker" />

type BuildTerrainGridRequest = {
	kind: 'build-terrain-grid'
	requestId: number
	columns: number
	rows: number
	cellSize: number
	width: number
	depth: number
	majorSpacing: number
	minorSpacing: number
	lineOffset: number
	minRow: number
	maxRow: number
	minColumn: number
	maxColumn: number
	heightIndices: ArrayBuffer
	heightValues: ArrayBuffer
	heightEntryCount: number
}

type BuildTerrainGridResponse = {
	kind: 'build-terrain-grid-result'
	requestId: number
	minor: ArrayBuffer
	major: ArrayBuffer
	heightMin: number
	heightMax: number
	error?: string
}

function isAligned(coord: number, spacing: number): boolean {
	if (spacing <= 0) {
		return false
	}
	const nearest = Math.round(coord / spacing) * spacing
	const distance = Math.abs(coord - nearest)
	return distance < Math.max(spacing * 0.01, 1e-3)
}

function buildGridSegmentsInWorker(message: BuildTerrainGridRequest): { minor: Float32Array; major: Float32Array } {
	const columns = Math.max(1, Math.floor(message.columns))
	const rows = Math.max(1, Math.floor(message.rows))
	const cellSize = Math.max(1e-4, message.cellSize)
	const width = Math.max(Math.abs(message.width), columns * cellSize)
	const depth = Math.max(Math.abs(message.depth), rows * cellSize)
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const stepX = columns > 0 ? width / columns : 0
	const stepZ = rows > 0 ? depth / rows : 0

	const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)))
	const minRow = clampInt(message.minRow, 0, rows)
	const maxRow = clampInt(message.maxRow, 0, rows)
	const minColumn = clampInt(message.minColumn, 0, columns)
	const maxColumn = clampInt(message.maxColumn, 0, columns)
	const cellRows = Math.max(0, maxRow - minRow)
	const cellColumns = Math.max(0, maxColumn - minColumn)
	if (cellRows === 0 || cellColumns === 0) {
		return { minor: new Float32Array(0), major: new Float32Array(0) }
	}

	const xCoords = new Float32Array(columns + 1)
	const zCoords = new Float32Array(rows + 1)
	for (let columnIndex = 0; columnIndex <= columns; columnIndex += 1) {
		xCoords[columnIndex] = -halfWidth + columnIndex * stepX
	}
	for (let rowIndex = 0; rowIndex <= rows; rowIndex += 1) {
		zCoords[rowIndex] = -halfDepth + rowIndex * stepZ
	}

	const stride = columns + 1
	const heightGrid = new Float32Array((rows + 1) * stride)
	const indices = new Uint32Array(message.heightIndices)
	const values = new Float32Array(message.heightValues)
	const count = Math.max(0, Math.min(message.heightEntryCount, indices.length, values.length))
	let heightMin = 0
	let heightMax = 0
	for (let i = 0; i < count; i += 1) {
		const idx = indices[i]!
		const value = values[i]!
		if (idx < heightGrid.length) {
			heightGrid[idx] = value
		}
		// 地形未编辑的点隐含为 0，因此初始 min/max 从 0 开始即可。
		heightMin = Math.min(heightMin, value)
		heightMax = Math.max(heightMax, value)
	}

	const majorRows: number[] = []
	const minorRows: number[] = []
	const majorColumns: number[] = []
	const minorColumns: number[] = []

	for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
		const z = zCoords[rowIndex]!
		if (isAligned(z, message.majorSpacing)) {
			majorRows.push(rowIndex)
		} else if (isAligned(z, message.minorSpacing)) {
			minorRows.push(rowIndex)
		}
	}

	for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
		const x = xCoords[columnIndex]!
		if (isAligned(x, message.majorSpacing)) {
			majorColumns.push(columnIndex)
		} else if (isAligned(x, message.minorSpacing)) {
			minorColumns.push(columnIndex)
		}
	}

	const majorSegmentCount = majorRows.length * cellColumns + majorColumns.length * cellRows
	const minorSegmentCount = minorRows.length * cellColumns + minorColumns.length * cellRows
	const major = new Float32Array(majorSegmentCount * 6)
	const minor = new Float32Array(minorSegmentCount * 6)

	let majorOffset = 0
	let minorOffset = 0
	const lineOffset = message.lineOffset

	const writeSegment = (
		target: Float32Array,
		offset: number,
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
	) => {
		target[offset] = ax
		target[offset + 1] = ay
		target[offset + 2] = az
		target[offset + 3] = bx
		target[offset + 4] = by
		target[offset + 5] = bz
	}

	for (let i = 0; i < majorRows.length; i += 1) {
		const rowIndex = majorRows[i]!
		const z = zCoords[rowIndex]!
		const base = rowIndex * stride
		for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
			const ax = xCoords[columnIndex]!
			const bx = xCoords[columnIndex + 1]!
			const ay = heightGrid[base + columnIndex]! + lineOffset
			const by = heightGrid[base + columnIndex + 1]! + lineOffset
			writeSegment(major, majorOffset, ax, ay, z, bx, by, z)
			majorOffset += 6
		}
	}

	for (let i = 0; i < minorRows.length; i += 1) {
		const rowIndex = minorRows[i]!
		const z = zCoords[rowIndex]!
		const base = rowIndex * stride
		for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
			const ax = xCoords[columnIndex]!
			const bx = xCoords[columnIndex + 1]!
			const ay = heightGrid[base + columnIndex]! + lineOffset
			const by = heightGrid[base + columnIndex + 1]! + lineOffset
			writeSegment(minor, minorOffset, ax, ay, z, bx, by, z)
			minorOffset += 6
		}
	}

	for (let i = 0; i < majorColumns.length; i += 1) {
		const columnIndex = majorColumns[i]!
		const x = xCoords[columnIndex]!
		for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
			const az = zCoords[rowIndex]!
			const bz = zCoords[rowIndex + 1]!
			const ay = heightGrid[rowIndex * stride + columnIndex]! + lineOffset
			const by = heightGrid[(rowIndex + 1) * stride + columnIndex]! + lineOffset
			writeSegment(major, majorOffset, x, ay, az, x, by, bz)
			majorOffset += 6
		}
	}

	for (let i = 0; i < minorColumns.length; i += 1) {
		const columnIndex = minorColumns[i]!
		const x = xCoords[columnIndex]!
		for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
			const az = zCoords[rowIndex]!
			const bz = zCoords[rowIndex + 1]!
			const ay = heightGrid[rowIndex * stride + columnIndex]! + lineOffset
			const by = heightGrid[(rowIndex + 1) * stride + columnIndex]! + lineOffset
			writeSegment(minor, minorOffset, x, ay, az, x, by, bz)
			minorOffset += 6
		}
	}

	return { minor, major }
}

function computeHeightRange(message: BuildTerrainGridRequest): { heightMin: number; heightMax: number } {
	const values = new Float32Array(message.heightValues)
	const count = Math.max(0, Math.min(message.heightEntryCount, values.length))
	let heightMin = 0
	let heightMax = 0
	for (let i = 0; i < count; i += 1) {
		const value = values[i]!
		heightMin = Math.min(heightMin, value)
		heightMax = Math.max(heightMax, value)
	}
	return { heightMin, heightMax }
}

self.onmessage = (event: MessageEvent<BuildTerrainGridRequest>) => {
	const message = event.data
	if (!message || message.kind !== 'build-terrain-grid') {
		return
	}

	try {
		const { heightMin, heightMax } = computeHeightRange(message)
		const { minor, major } = buildGridSegmentsInWorker(message)
		const response: BuildTerrainGridResponse = {
			kind: 'build-terrain-grid-result',
			requestId: message.requestId,
			minor: minor.buffer as ArrayBuffer,
			major: major.buffer as ArrayBuffer,
			heightMin,
			heightMax,
		}
		self.postMessage(response, [response.minor, response.major])
	} catch (error) {
		const response: BuildTerrainGridResponse = {
			kind: 'build-terrain-grid-result',
			requestId: message.requestId,
			minor: new ArrayBuffer(0),
			major: new ArrayBuffer(0),
			heightMin: 0,
			heightMax: 0,
			error: error instanceof Error ? error.message : String(error),
		}
		self.postMessage(response)
	}
}
