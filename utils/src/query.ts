function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseQueryString(input: string): Record<string, string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  const decodedInput = safeDecodeURIComponent(trimmed);
  const queryIndex = decodedInput.indexOf('?');
  const queryString = queryIndex >= 0 ? decodedInput.slice(queryIndex + 1) : decodedInput;
  const hashIndex = queryString.indexOf('#');
  const normalizedQueryString = hashIndex >= 0 ? queryString.slice(0, hashIndex) : queryString;

  if (!normalizedQueryString) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const segment of normalizedQueryString.split('&')) {
    if (!segment) {
      continue;
    }

    const equalsIndex = segment.indexOf('=');
    const rawKey = equalsIndex >= 0 ? segment.slice(0, equalsIndex) : segment;
    const rawValue = equalsIndex >= 0 ? segment.slice(equalsIndex + 1) : '';

    const key = safeDecodeURIComponent(rawKey.replace(/\+/g, ' '));
    if (!key) {
      continue;
    }

    result[key] = safeDecodeURIComponent(rawValue.replace(/\+/g, ' '));
  }

  return result;
}

export function buildQueryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const segments = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return segments.length > 0 ? `?${segments.join('&')}` : '';
}