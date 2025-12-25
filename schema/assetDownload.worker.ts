/// <reference lib="webworker" />

type AssetDownloadWorkerRequest = {
	kind: 'asset-download'
	requestId: number
	urlCandidates: string[]
}

type AssetDownloadWorkerAbort = {
	kind: 'asset-download-abort'
	requestId: number
}

type AssetDownloadWorkerProgress = {
	kind: 'asset-download-progress'
	requestId: number
	progress: number
}

type AssetDownloadWorkerResult = {
	kind: 'asset-download-result'
	requestId: number
	arrayBuffer: ArrayBuffer
	mimeType: string | null
	filename: string | null
	url: string
}

type AssetDownloadWorkerError = {
	kind: 'asset-download-error'
	requestId: number
	error: string
}

type AssetDownloadWorkerMessage = AssetDownloadWorkerRequest | AssetDownloadWorkerAbort

const inFlight = new Map<number, AbortController>()

function postProgress(requestId: number, progress: number) {
	const payload: AssetDownloadWorkerProgress = {
		kind: 'asset-download-progress',
		requestId,
		progress,
	}
	self.postMessage(payload)
}

function postError(requestId: number, error: string) {
	const payload: AssetDownloadWorkerError = {
		kind: 'asset-download-error',
		requestId,
		error,
	}
	self.postMessage(payload)
}

function postResult(requestId: number, result: Omit<AssetDownloadWorkerResult, 'kind' | 'requestId'>) {
	const payload: AssetDownloadWorkerResult = {
		kind: 'asset-download-result',
		requestId,
		...result,
	}
	self.postMessage(payload, [payload.arrayBuffer])
}

function extractFilenameFromHeaders(headers: Headers, fallbackUrl: string): string | null {
	const contentDisposition = headers.get('content-disposition')
	if (contentDisposition) {
		const filenameMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
		if (filenameMatch) {
			const encoded = filenameMatch[1] ?? filenameMatch[2]
			if (encoded) {
				try {
					return decodeURIComponent(encoded)
				} catch {
					return encoded
				}
			}
		}
	}
	return extractFilenameFromUrl(fallbackUrl)
}

function extractFilenameFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url)
		const segment = parsed.pathname.split('/').filter(Boolean).pop()
		if (segment) {
			return decodeURIComponent(segment)
		}
	} catch {
		// noop
	}
	return null
}

function concatChunks(chunks: Uint8Array[], totalLength: number): ArrayBuffer {
	const result = new Uint8Array(totalLength)
	let offset = 0
	for (const chunk of chunks) {
		result.set(chunk, offset)
		offset += chunk.byteLength
	}
	return result.buffer
}

async function downloadWithCandidates(params: {
	requestId: number
	urlCandidates: string[]
	signal: AbortSignal
}): Promise<{ arrayBuffer: ArrayBuffer; mimeType: string | null; filename: string | null; url: string }> {
	const { requestId, urlCandidates, signal } = params
	if (!urlCandidates.length) {
		throw new Error('资源下载失败（无效的下载地址）')
	}

	let lastNetworkError: unknown = null
	for (const candidate of urlCandidates) {
		try {
			const response = await fetch(candidate, { signal })
			if (!response.ok) {
				throw new Error(`资源下载失败（${response.status}）`)
			}

			const mimeType = response.headers.get('content-type')
			const resolvedUrl = response.url || candidate
			const filename = extractFilenameFromHeaders(response.headers, resolvedUrl)

			// If streams are not available, fall back to arrayBuffer().
			if (!response.body || typeof response.body.getReader !== 'function') {
				const arrayBuffer = await response.arrayBuffer()
				postProgress(requestId, 100)
				return { arrayBuffer, mimeType, filename, url: resolvedUrl }
			}

			const reader = response.body.getReader()
			const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
			const chunks: Uint8Array[] = []
			let received = 0
			let lastEmitted = -1

			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}
				if (value) {
					chunks.push(value)
					received += value.byteLength
					let progress = 0
					if (total > 0) {
						progress = Math.min(99, Math.round((received / total) * 100))
					} else {
						progress = Math.min(95, received % 100)
					}
					if (progress !== lastEmitted) {
						lastEmitted = progress
						postProgress(requestId, progress)
					}
				}
			}

			const arrayBuffer = concatChunks(chunks, received)
			postProgress(requestId, 100)
			return { arrayBuffer, mimeType, filename, url: resolvedUrl }
		} catch (error) {
			// Keep trying other candidates for certain network errors.
			lastNetworkError = error
			continue
		}
	}

	throw lastNetworkError instanceof Error ? lastNetworkError : new Error(String(lastNetworkError ?? '资源下载失败'))
}

self.onmessage = async (event: MessageEvent<AssetDownloadWorkerMessage>) => {
	const message = event.data
	if (!message) {
		return
	}

	if (message.kind === 'asset-download-abort') {
		const controller = inFlight.get(message.requestId)
		controller?.abort()
		inFlight.delete(message.requestId)
		return
	}

	if (message.kind !== 'asset-download') {
		return
	}

	const requestId = message.requestId
	const controller = new AbortController()
	inFlight.set(requestId, controller)

	try {
		postProgress(requestId, 0)
		const result = await downloadWithCandidates({
			requestId,
			urlCandidates: message.urlCandidates ?? [],
			signal: controller.signal,
		})
		inFlight.delete(requestId)
		postResult(requestId, result)
	} catch (error) {
		inFlight.delete(requestId)
		const msg = error instanceof Error ? error.message : String(error)
		postError(requestId, msg)
	}
}
