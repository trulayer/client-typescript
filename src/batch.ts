import type { TraceData } from './model.js'
import { traceToWire } from './model.js'
import {
  InvalidAPIKeyError,
  TruLayerFlushError,
  isInvalidAPIKeyPayload,
} from './errors.js'

const MAX_RETRIES = 3
const RETRY_BASE_MS = 500
/**
 * Window (ms) after which a fresh drop-mode warning will be emitted. We
 * suppress warnings inside this window so a dead ingest endpoint doesn't
 * flood the user's logs with one message per batch.
 */
const WARN_WINDOW_MS = 60_000

export interface BatchSenderOptions {
  /** Raise {@link TruLayerFlushError} from `flush()` / `shutdown()` when a
   *  batch fails every retry. When false (default) the SDK drops the
   *  batch and logs a single warning per {@link WARN_WINDOW_MS} window. */
  failMode?: 'drop' | 'block'
}

/**
 * Resolve the effective fail mode from constructor options and the
 * `TRULAYER_FAIL_MODE` environment variable. Explicit options win over
 * env so tests can override without polluting `process.env`.
 */
export function resolveFailMode(
  explicit?: 'drop' | 'block',
): 'drop' | 'block' {
  if (explicit !== undefined) return explicit
  if (typeof process !== 'undefined') {
    const env = process.env['TRULAYER_FAIL_MODE']
    if (env === 'block') return 'block'
    if (env === 'drop') return 'drop'
  }
  return 'drop'
}

export class BatchSender {
  private buffer: TraceData[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  /**
   * Set when the API has told us the credentials are permanently bad.
   * Once latched, the sender drops all queued and future events — retrying
   * would waste the backend's time and cannot succeed.
   */
  private fatalError: InvalidAPIKeyError | null = null
  /** Timestamp of the most recent drop-mode warning (ms since epoch). */
  private lastWarnAt: number = 0
  /** Resolves when every in-flight send settles — lets `shutdown()` surface
   *  block-mode errors raised from a batch that was kicked off by a prior
   *  `flush()`. */
  private inflight: Promise<void> = Promise.resolve()
  private readonly failMode: 'drop' | 'block'

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly batchSize: number,
    private readonly flushInterval: number,
    options?: BatchSenderOptions,
  ) {
    this.failMode = resolveFailMode(options?.failMode)
    this.scheduleFlush()
  }

  enqueue(trace: TraceData): void {
    if (this.fatalError) return
    this.buffer.push(trace)
    if (this.buffer.length >= this.batchSize) {
      this.flush()
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.fatalError) {
      this.buffer = []
      return
    }
    const items = this.buffer.splice(0)
    if (items.length > 0) {
      // Fire-and-forget — never blocks the caller. Retain the promise so
      // `shutdown()` can await it and surface block-mode errors.
      const send = this.sendWithRetry(items).catch(() => {
        // Swallow here; block-mode errors are re-raised via `inflight` and
        // `shutdown()`. Drop-mode errors are already logged inside
        // `sendWithRetry`.
      })
      this.inflight = this.inflight.then(() => send)
    }
    this.scheduleFlush()
  }

  async shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // Drain previously-kicked-off sends first. In block mode their errors
    // are queued on `pendingBlockError` below and rethrown after the final
    // flush settles, so the caller sees the first failure in order.
    await this.inflight
    if (this.fatalError) {
      this.buffer = []
      return
    }
    const items = this.buffer.splice(0)
    if (items.length === 0) return
    await this.sendWithRetry(items)
  }

  /**
   * Returns the latched non-retryable error, if any. Exposed for tests and
   * for callers that want to surface configuration failures proactively.
   */
  getFatalError(): InvalidAPIKeyError | null {
    return this.fatalError
  }

  /** @internal Exposed for tests. */
  getFailMode(): 'drop' | 'block' {
    return this.failMode
  }

  private scheduleFlush(): void {
    if (this.fatalError) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.flushInterval)
    // Don't hold the Node.js event loop open
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      ;(this.timer as NodeJS.Timeout).unref()
    }
  }

  private async sendWithRetry(items: TraceData[], attempt = 0): Promise<void> {
    try {
      const resp = await globalThis.fetch(`${this.endpoint}/v1/ingest/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ traces: items.map(traceToWire) }),
      })
      if (!resp.ok) {
        if (resp.status === 401) {
          let payload: unknown = null
          try {
            payload = await resp.json()
          } catch {
            // Fall through — not every 401 has a JSON body
          }
          const match = isInvalidAPIKeyPayload(payload)
          if (match) {
            this.fatalError = new InvalidAPIKeyError(match.code)
            // Stop the flush timer and drop any remaining queued items.
            if (this.timer !== null) {
              clearTimeout(this.timer)
              this.timer = null
            }
            this.buffer = []
            console.warn(
              `[trulayer] ${this.fatalError.message} (code: ${match.code}) ` +
                `— halting trace submission for this client.`,
            )
            return
          }
        }
        throw new Error(`HTTP ${resp.status}`)
      }
    } catch (err) {
      if (attempt >= MAX_RETRIES - 1) {
        if (this.failMode === 'block') {
          // Opt-in: propagate as a typed error so critical paths can
          // observe ingest failure. The SDK still retried 3× with
          // exponential backoff before reaching this point.
          throw new TruLayerFlushError(
            `failed to send batch of ${items.length} traces after ${MAX_RETRIES} retries`,
            items.length,
            err,
          )
        }
        const now = Date.now()
        if (now - this.lastWarnAt >= WARN_WINDOW_MS) {
          console.warn(
            `[trulayer] failed to send batch of ${items.length} traces after ${MAX_RETRIES} retries:`,
            err,
          )
          this.lastWarnAt = now
        }
        return
      }
      const delay = RETRY_BASE_MS * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
      return this.sendWithRetry(items, attempt + 1)
    }
  }
}
