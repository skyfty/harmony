export interface ParsedUrl {
  protocol: string
  username: string
  password: string
  host: string
  pathname: string
  search: string
  hash: string
}

function formatParsedUrl(value: ParsedUrl): string {
  const protocol = value.protocol || 'https:'
  const pathname = value.pathname && value.pathname.length ? value.pathname : '/'
  const search = value.search || ''
  const hash = value.hash || ''
  const hasUsername = typeof value.username === 'string' && value.username.length > 0
  const userinfo = hasUsername ? `${value.username}${value.password ? `:${value.password}` : ''}@` : ''
  return `${protocol}//${userinfo}${value.host}${pathname}${search}${hash}`
}

export function rewriteUrlHostOrOrigin(source: ParsedUrl, mirrorHostOrOrigin: string): string | null {
  const value = typeof mirrorHostOrOrigin === 'string' ? mirrorHostOrOrigin.trim() : ''
  if (!value) {
    return null
  }

  // If mirror is an origin (has scheme), use its protocol/host and credentials.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const mirror = tryParseUrl(value)
    if (!mirror) {
      return null
    }
    return formatParsedUrl({
      ...source,
      protocol: mirror.protocol,
      username: mirror.username,
      password: mirror.password,
      host: mirror.host,
    })
  }

  // If mirror is scheme-relative (e.g. //cdn.example.com), treat as https.
  if (/^\/\//.test(value)) {
    const mirror = tryParseUrl(value)
    if (!mirror) {
      return null
    }
    return formatParsedUrl({
      ...source,
      protocol: mirror.protocol,
      host: mirror.host,
    })
  }

  // Otherwise treat as host[:port], preserve protocol and other URL parts.
  // Reject obvious non-host inputs.
  if (/[\s/?#]/.test(value)) {
    return null
  }
  return formatParsedUrl({
    ...source,
    host: value,
  })
}

export function tryParseUrl(url: string): ParsedUrl | null {
  const input = typeof url === 'string' ? url.trim() : ''
  if (!input) {
    return null
  }

  // Support scheme-relative URLs (//example.com/path) by assuming https.
  const schemeRelative = /^\/\//.test(input)
  const protocolMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)
  let protocol = 'https:'
  if (!schemeRelative) {
    const scheme = protocolMatch && typeof protocolMatch[1] === 'string' ? protocolMatch[1] : ''
    protocol = scheme ? `${scheme.toLowerCase()}:` : ''
  }

  if (!schemeRelative && !protocolMatch) {
    // Keep behavior close to the old `new URL(url)` without a base: only accept absolute URLs.
    return null
  }

  const afterSlashes = schemeRelative ? input.slice(2) : input.slice((protocolMatch?.[0]?.length ?? 0))

  const authorityEndIndex = (() => {
    const slash = afterSlashes.indexOf('/')
    const query = afterSlashes.indexOf('?')
    const hash = afterSlashes.indexOf('#')
    const indices = [slash, query, hash].filter((value) => value >= 0)
    return indices.length ? Math.min(...indices) : afterSlashes.length
  })()

  const authority = afterSlashes.slice(0, authorityEndIndex)
  const rest = afterSlashes.slice(authorityEndIndex)
  if (!authority) {
    return null
  }

  let username = ''
  let password = ''
  let host = authority

  const atIndex = authority.lastIndexOf('@')
  if (atIndex >= 0) {
    const userinfo = authority.slice(0, atIndex)
    host = authority.slice(atIndex + 1)
    const colonIndex = userinfo.indexOf(':')
    if (colonIndex >= 0) {
      username = userinfo.slice(0, colonIndex)
      password = userinfo.slice(colonIndex + 1)
    } else {
      username = userinfo
    }
  }

  if (!host) {
    return null
  }

  let pathname = '/'
  let search = ''
  let hash = ''

  if (rest.startsWith('/')) {
    const hashIndex = rest.indexOf('#')
    const queryIndex = rest.indexOf('?')
    const pathEndIndex = (() => {
      if (queryIndex >= 0 && hashIndex >= 0) {
        return Math.min(queryIndex, hashIndex)
      }
      if (queryIndex >= 0) {
        return queryIndex
      }
      if (hashIndex >= 0) {
        return hashIndex
      }
      return rest.length
    })()
    pathname = rest.slice(0, pathEndIndex) || '/'
    const afterPath = rest.slice(pathEndIndex)
    if (afterPath.startsWith('?')) {
      const hashInQuery = afterPath.indexOf('#')
      if (hashInQuery >= 0) {
        search = afterPath.slice(0, hashInQuery)
        hash = afterPath.slice(hashInQuery)
      } else {
        search = afterPath
      }
    } else if (afterPath.startsWith('#')) {
      hash = afterPath
    }
  } else if (rest.startsWith('?')) {
    const hashIndex = rest.indexOf('#')
    if (hashIndex >= 0) {
      search = rest.slice(0, hashIndex)
      hash = rest.slice(hashIndex)
    } else {
      search = rest
    }
  } else if (rest.startsWith('#')) {
    hash = rest
  }

  return {
    protocol: protocol || 'https:',
    username,
    password,
    host,
    pathname,
    search,
    hash,
  }
}
