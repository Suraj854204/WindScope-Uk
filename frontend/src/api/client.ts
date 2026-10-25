import type {
  Accuracy,
  AppConfig,
  DatasetStatus,
  IntervalDetail,
  IntervalsPage,
  Quality,
  RefreshResult,
  Sensitivity,
  Series,
  SortKey,
  Summary,
} from './types'

/** Query parameters shared by every analysis endpoint (date range + decision cutoff). */
export interface AnalysisQuery {
  date_from?: string
  date_to?: string
  cutoff_mode?: 'day_ahead' | 'lead_time'
  cutoff_time?: string
  days_before?: number
  lead_hours?: number
}

export interface IntervalsQuery extends AnalysisQuery {
  page?: number
  page_size?: number
  sort_by?: SortKey
  sort_dir?: 'asc' | 'desc'
  status?: string
  direction?: 'all' | 'over' | 'under' | 'exact'
  q?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number | null
  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
  /** True when the API could not be reached at all (as opposed to returning an error). */
  get isNetwork(): boolean {
    return this.code === 'network' || this.code === 'timeout'
  }
}

const TIMEOUT_MS = 45_000

export function apiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
  return raw.replace(/\/+$/, '')
}

export function buildQuery(params: object): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    usp.set(key, String(value))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'http_error'
  let message = `The API returned HTTP ${res.status}.`
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.message) message = body.error.message
    if (body.error?.code) code = body.error.code
  } catch {
    // Non-JSON body: typically a proxy/gateway answering because the backend is down.
    if (res.status >= 500)
      message = `The WindScope API is unavailable (HTTP ${res.status}). Check that the backend is running.`
  }
  return new ApiError(code, message, res.status)
}

async function request(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS)
  const onAbort = () => ctrl.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${apiBase()}${path}`, { ...init, signal: ctrl.signal })
    if (!res.ok) throw await parseError(res)
    return res
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (signal?.aborted) throw err // caller cancelled: let react-query handle it silently
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new ApiError('timeout', 'The API took too long to respond.')
    }
    throw new ApiError('network', 'Could not reach the WindScope API. Check that the backend is running.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await request(path, undefined, signal)
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('bad_response', 'The API returned an unreadable response.', res.status)
  }
}

export const api = {
  config: (signal?: AbortSignal) => getJson<AppConfig>('/api/v1/config', signal),
  datasetStatus: (signal?: AbortSignal) => getJson<DatasetStatus>('/api/v1/dataset/status', signal),
  refresh: async (force: boolean): Promise<RefreshResult> => {
    const res = await request('/api/v1/dataset/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    })
    return (await res.json()) as RefreshResult
  },
  summary: (q: AnalysisQuery, signal?: AbortSignal) =>
    getJson<Summary>(`/api/v1/analysis/summary${buildQuery(q)}`, signal),
  series: (q: AnalysisQuery, signal?: AbortSignal) =>
    getJson<Series>(`/api/v1/analysis/series${buildQuery(q)}`, signal),
  intervals: (q: IntervalsQuery, signal?: AbortSignal) =>
    getJson<IntervalsPage>(`/api/v1/analysis/intervals${buildQuery(q)}`, signal),
  intervalDetail: (startTime: string, q: AnalysisQuery, signal?: AbortSignal) =>
    getJson<IntervalDetail>(
      `/api/v1/analysis/intervals/${encodeURIComponent(startTime)}${buildQuery(q)}`,
      signal,
    ),
  accuracy: (q: AnalysisQuery & { granularity?: 'day' | 'week'; top_n?: number }, signal?: AbortSignal) =>
    getJson<Accuracy>(`/api/v1/analysis/accuracy${buildQuery(q)}`, signal),
  sensitivity: (q: AnalysisQuery, signal?: AbortSignal) =>
    getJson<Sensitivity>(`/api/v1/analysis/cutoff-sensitivity${buildQuery(q)}`, signal),
  quality: (q: AnalysisQuery, signal?: AbortSignal) =>
    getJson<Quality>(`/api/v1/quality${buildQuery(q)}`, signal),
  /** Downloads the CSV for exactly the rows matching `q` (all pages). */
  intervalsCsv: async (q: IntervalsQuery): Promise<{ blob: Blob; filename: string }> => {
    const { page: _p, page_size: _s, ...filters } = q
    const res = await request(`/api/v1/analysis/intervals.csv${buildQuery(filters)}`)
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = /filename="?([^";]+)"?/.exec(disposition)
    return { blob: await res.blob(), filename: match?.[1] ?? 'windscope_intervals.csv' }
  },
}
