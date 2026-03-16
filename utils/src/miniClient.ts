import { getApiOrigin, getAuthToken, getBaseUrl, HttpError, httpRequest } from './http';
import type { HttpRequestOptions } from './http';

type RequestErrorKind = 'auth' | 'network' | 'server' | 'business' | 'unknown';

type MiniApiEnvelope<T> = {
  code: number;
  data: T;
  message: string;
};

export interface TrackAnalyticsEventPayload {
  eventType: string;
  sceneId?: string;
  sceneSpotId?: string;
  sessionId?: string;
  source?: string;
  device?: string;
  path?: string;
  dwellMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CreatePunchRecordPayload {
  sceneId: string;
  scenicId: string;
  sceneName: string;
  clientPunchTime: string;
  behaviorPunchTime?: string;
  location: {
    nodeId: string;
    nodeName: string;
  };
  source?: string;
  path?: string;
}

export interface CreateTravelEnterPayload {
  sceneId: string;
  scenicId: string;
  sceneName?: string;
  enterTime?: string;
  source?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTravelLeavePayload {
  sceneId: string;
  scenicId: string;
  leaveTime?: string;
  source?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export class MiniApiError extends Error {
  kind: RequestErrorKind;
  status?: number;
  code?: number;

  constructor(message: string, options: { kind: RequestErrorKind; status?: number; code?: number }) {
    super(message);
    this.name = 'MiniApiError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
  }
}

export type MiniAuthRecoveryContext = {
  path: string;
  target: string;
  method: string;
  status?: number;
};

type MiniAuthRecoveryHandler = (context: MiniAuthRecoveryContext) => Promise<boolean> | boolean;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const GET_RETRY_LIMIT = 2;
const GET_RETRY_BASE_DELAY_MS = 250;
const inFlightGetRequests = new Map<string, Promise<unknown>>();
let miniAuthRecoveryHandler: MiniAuthRecoveryHandler | null = null;
let pendingMiniAuthRecovery: Promise<boolean> | null = null;

export function setMiniAuthRecoveryHandler(handler: MiniAuthRecoveryHandler | null): void {
  miniAuthRecoveryHandler = handler;
}

function isMiniApiEnvelope<T>(value: unknown): value is MiniApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string';
}

function isAbsoluteUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

function resolveRequestTarget(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }
  
  if (path.startsWith('/mini-auth/')) {
    return `${getApiOrigin()}/api${path}`;
  }

  return `${getBaseUrl()}${path}`;
}

function buildQueryString(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return '';

  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);

  if (!params.length) return '';
  const parts = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const text = parts.join('&');
  return text ? `?${text}` : '';
}

async function requestWithUni<R>(target: string, options: HttpRequestOptions): Promise<R> {
  const method = options.method === 'PATCH' ? 'POST' : (options.method ?? 'GET');
  const extraHeaders = options.method === 'PATCH' ? { 'X-HTTP-Method-Override': 'PATCH' } : {};
  const authHeader = options.auth === false || !getAuthToken() ? {} : { Authorization: `Bearer ${getAuthToken()}` };
  return await new Promise<R>((resolve, reject) => {
    uni.request({
      url: `${target}${buildQueryString(options.query)}`,
      method,
      data: options.body as any,
      timeout: options.timeoutMs ?? 20000,
      header: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
        ...extraHeaders,
        ...authHeader,
      },
      success: (response: { statusCode?: number; data?: unknown }) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(response.data as R);
          return;
        }
        const message =
          typeof (response.data as { message?: unknown } | undefined)?.message === 'string'
            ? (response.data as { message: string }).message
            : `HTTP ${statusCode}`;
        reject(new HttpError(message, statusCode, response.data));
      },
      fail: (error: unknown) => {
        reject(error);
      },
    });
  });
}

async function requestWithFetch<R>(target: string, options: HttpRequestOptions): Promise<R> {
  const authHeader = options.auth === false || !getAuthToken() ? {} : { Authorization: `Bearer ${getAuthToken()}` };
  const response = await fetch(`${target}${buildQueryString(options.query)}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...authHeader,
    },
    ...(options.body === undefined
      ? {}
      : {
          body: JSON.stringify(options.body),
        }),
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (response.ok) {
    return data as R;
  }

  const message = typeof (data as { message?: unknown } | undefined)?.message === 'string'
    ? (data as { message: string }).message
    : `HTTP ${response.status}`;
  throw new HttpError(message, response.status, data);
}

async function requestRaw<R>(target: string, options: HttpRequestOptions): Promise<R> {
  if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
    return await requestWithUni<R>(target, options);
  }

  try {
    return await httpRequest<R>(target, options);
  } catch {
    return await requestWithFetch<R>(target, options);
  }
}

function stringifyQuery(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return '';
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function buildGetRequestKey(target: string, options: HttpRequestOptions): string {
  return `${target}::${stringifyQuery(options.query)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapRequestError(error: unknown): MiniApiError {
  if (error instanceof MiniApiError) {
    return error;
  }

  if (error instanceof HttpError) {
    if (error.status === 401) {
      return new MiniApiError(error.message || 'Unauthorized', { kind: 'auth', status: error.status });
    }
    if (RETRYABLE_STATUS.has(error.status)) {
      return new MiniApiError(error.message || 'Server unavailable', { kind: 'server', status: error.status });
    }
    return new MiniApiError(error.message || 'Request failed', { kind: 'unknown', status: error.status });
  }

  if (error instanceof Error) {
    return new MiniApiError(error.message || 'Network error', { kind: 'network' });
  }

  return new MiniApiError('Network error', { kind: 'network' });
}

async function executeWithRetry<T>(target: string, options: HttpRequestOptions): Promise<T> {
  const method = options.method ?? 'GET';
  const maxAttempts = method === 'GET' ? GET_RETRY_LIMIT + 1 : 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      const payload = await requestRaw<MiniApiEnvelope<T> | T>(target, {
        ...options,
        headers: {
          ...(options.headers ?? {}),
        },
      });

      if (!isMiniApiEnvelope<T>(payload)) {
        return payload as T;
      }

      if (payload.code !== 0) {
        throw new MiniApiError(payload.message || 'API request failed', {
          kind: 'business',
          code: payload.code,
        });
      }

      return payload.data;
    } catch (rawError) {
      const error = mapRequestError(rawError);
      attempt += 1;
      const shouldRetry =
        method === 'GET' &&
        attempt < maxAttempts &&
        (error.kind === 'network' || error.kind === 'server');

      if (!shouldRetry) {
        throw error;
      }

      const backoff = GET_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(backoff);
    }
  }

  throw new MiniApiError('Request failed', { kind: 'unknown' });
}

async function executeWithAuthRecovery<T>(path: string, target: string, options: HttpRequestOptions): Promise<T> {
  try {
    return await executeWithRetry<T>(target, options);
  } catch (rawError) {
    const error = mapRequestError(rawError);
    if (error.kind !== 'auth' || options.auth === false || !miniAuthRecoveryHandler) {
      throw error;
    }

    if (!pendingMiniAuthRecovery) {
      pendingMiniAuthRecovery = Promise.resolve(
        miniAuthRecoveryHandler({
          path,
          target,
          method: options.method ?? 'GET',
          status: error.status,
        }),
      )
        .catch(() => false)
        .finally(() => {
          pendingMiniAuthRecovery = null;
        });
    }

    const recovered = await pendingMiniAuthRecovery;
    if (!recovered) {
      throw error;
    }

    return await executeWithRetry<T>(target, options);
  }
}

export async function miniRequest<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  console.log("dddddddddddddddddddddddddddd 1111111111111111111", path);
  const method = options.method ?? 'GET';
  const target = resolveRequestTarget(path);

  console.log("dddddddddddddddddddddddddddd 222ddddddddddd22222222222222222222", target,method);
  if (method === 'GET') {
    const requestKey = buildGetRequestKey(target, options);
    const inFlight = inFlightGetRequests.get(requestKey) as Promise<T> | undefined;
    if (inFlight) {
      return await inFlight;
    }
    const pending = executeWithAuthRecovery<T>(path, target, { ...options, method: 'GET' });
    inFlightGetRequests.set(requestKey, pending);
    try {
      return await pending;
    } finally {
      inFlightGetRequests.delete(requestKey);
    }
  }
  return await executeWithAuthRecovery<T>(path, target, options);
}

export function trackAnalyticsEvent(payload: TrackAnalyticsEventPayload): Promise<{ success: boolean }> {
  return miniRequest<{ success: boolean }>('/analytics/events', {
    method: 'POST',
    body: payload,
  });
}

export function createPunchRecord(payload: CreatePunchRecordPayload): Promise<{ success: boolean; id: string }> {
  return miniRequest<{ success: boolean; id: string }>('/punch-records', {
    method: 'POST',
    body: payload,
  });
}

export function createTravelEnterRecord(payload: CreateTravelEnterPayload): Promise<{ success: boolean; id: string }> {
  return miniRequest<{ success: boolean; id: string }>('/travel-records/enter', {
    method: 'POST',
    body: payload,
  });
}

export function completeTravelLeaveRecord(payload: CreateTravelLeavePayload): Promise<{ success: boolean; id: string | null }> {
  return miniRequest<{ success: boolean; id: string | null }>('/travel-records/leave', {
    method: 'POST',
    body: payload,
  });
}