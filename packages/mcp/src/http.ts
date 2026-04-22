import { TruLayerApiError } from './errors.js'
import { USER_AGENT } from './version.js'

export interface HttpClientOptions {
  baseUrl: string
  apiKey: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface RequestOptions {
  path: string
  query?: Record<string, string | number | boolean | undefined | null>
  timeoutMs?: number
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly defaultTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.defaultTimeoutMs = opts.timeoutMs ?? 30_000
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
  }

  async get<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query)
    const controller = new AbortController()
    const timeout = opts.timeoutMs ?? this.defaultTimeoutMs
    const timer = setTimeout(() => controller.abort(), timeout)

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TruLayerApiError(0, `request timed out after ${timeout}ms`)
      }
      throw new TruLayerApiError(
        0,
        `network error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    clearTimeout(timer)

    if (!res.ok) {
      const body = await safeReadText(res)
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      const msg = body.slice(0, 500) || res.statusText || 'unknown error'
      throw new TruLayerApiError(res.status, msg, retryAfter)
    }

    const text = await res.text()
    if (!text) return {} as T
    try {
      return JSON.parse(text) as T
    } catch (err) {
      throw new TruLayerApiError(
        res.status,
        `invalid JSON response: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    const u = new URL(path.startsWith('/') ? path : `/${path}`, this.baseUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue
        u.searchParams.set(k, String(v))
      }
    }
    return u.toString()
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const n = Number(header)
  if (Number.isFinite(n) && n >= 0) return n
  // HTTP-date format — convert to delta seconds.
  const dateMs = Date.parse(header)
  if (!Number.isNaN(dateMs)) {
    const delta = Math.max(0, Math.floor((dateMs - Date.now()) / 1000))
    return delta
  }
  return undefined
}
