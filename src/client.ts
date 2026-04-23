import type {
  BatchSenderLike,
  EvalRequest,
  EvalTriggerResponse,
  FeedbackData,
  TruLayerConfig,
} from './model.js'
import { BatchSender } from './batch.js'
import { LocalBatchSender } from './local-batch.js'
import { TraceContext, _ensureSpanStorage } from './trace.js'
import { NoopTraceContext } from './noop.js'

const DEFAULT_ENDPOINT = 'https://api.trulayer.ai'
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_FLUSH_INTERVAL = 2000

export class TruLayer {
  /** @internal Prevents duplicate local-mode warnings. */
  static _localWarned = false

  /** Project label sent on every trace. Despite the legacy field name on the
   *  wire (`project_id`), this is a human-readable name that the backend
   *  resolves against the API key's tenant. */
  readonly projectName: string
  /** @deprecated Use {@link TruLayer.projectName}. */
  get projectId(): string {
    return this.projectName
  }
  /** @internal */
  readonly _batch: BatchSenderLike
  /** @internal */
  readonly _sampleRate: number
  /** @internal */
  readonly _relayUrl: string | undefined
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly redact: ((data: unknown) => unknown) | undefined

  /** @internal `_batchOverride` allows the browser entry point to inject a
   *  relay-based sender without duplicating constructor logic. */
  constructor(config: TruLayerConfig, _batchOverride?: BatchSenderLike) {
    const isLocal =
      (typeof process !== 'undefined' && process.env['TRULAYER_MODE'] === 'local') ||
      _batchOverride instanceof LocalBatchSender

    if (!isLocal && !config.apiKey) throw new Error('[trulayer] apiKey is required')
    const name = config.projectName ?? config.projectId
    if (!isLocal && !name) throw new Error('[trulayer] projectName is required')
    if (config.projectId && !config.projectName && name) {
      console.warn(
        '[trulayer] `projectId` is deprecated; rename to `projectName`. Will be removed in 0.3.x.',
      )
    }

    if (isLocal && !TruLayer._localWarned) {
      console.warn('[trulayer] running in LOCAL mode — no data will be sent to the API')
      TruLayer._localWarned = true
    }

    this.apiKey = config.apiKey ?? ''
    this.projectName = name ?? 'local'
    this._sampleRate = config.sampleRate ?? 1.0
    this.redact = config.redact
    this._relayUrl = config.relayUrl
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')

    if (isLocal && !_batchOverride) {
      this._batch = new LocalBatchSender()
    } else {
      this._batch = _batchOverride ?? new BatchSender(
        this.apiKey,
        this.endpoint,
        config.batchSize ?? DEFAULT_BATCH_SIZE,
        config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      )
    }

    // Eagerly initialize AsyncLocalStorage for span nesting (fire-and-forget)
    void _ensureSpanStorage()
  }

  /** @internal Determine whether this trace should be sampled in. */
  private _shouldSample(): boolean {
    // Fast paths: avoid Math.random() when the decision is deterministic
    if (this._sampleRate >= 1.0) return true
    if (this._sampleRate <= 0.0) return false
    return Math.random() < this._sampleRate
  }

  async trace<T>(
    name: string,
    callback: (trace: TraceContext | NoopTraceContext) => Promise<T>,
    options?: {
      sessionId?: string
      externalId?: string
      tags?: string[]
      metadata?: Record<string, unknown>
    },
  ): Promise<T> {
    if (!this._shouldSample()) {
      const noop = new NoopTraceContext()
      return callback(noop)
    }

    const ctx = new TraceContext(
      this._batch,
      this.projectName,
      name,
      options?.sessionId,
      options?.tags,
      options?.metadata,
      options?.externalId,
      this.redact,
    )
    try {
      const result = await callback(ctx)
      ctx.finish()
      return result
    } catch (err) {
      ctx.finish(err)
      throw err
    }
  }

  feedback(traceId: string, label: string, options?: {
    score?: number
    comment?: string
    metadata?: Record<string, unknown>
  }): void {
    const body: FeedbackData = {
      trace_id: traceId,
      label,
      ...options,
    }

    // In browser/relay mode, send feedback through the relay without auth
    if (this._relayUrl) {
      void globalThis.fetch(this._relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feedback: body }),
      }).catch((err: unknown) => {
        console.warn('[trulayer] feedback submission failed:', err)
      })
      return
    }

    // Fire-and-forget — never throws
    void globalThis.fetch(`${this.endpoint}/v1/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }).catch((err: unknown) => {
      console.warn('[trulayer] feedback submission failed:', err)
    })
  }

  /**
   * Trigger an async evaluation for a previously ingested trace.
   *
   * Maps to `POST /v1/eval`. Returns the eval ID when the trigger was
   * accepted, or `null` on any failure (network, HTTP error, invalid
   * response). Never throws into user code.
   *
   * @param traceId - The UUIDv7 of the trace to evaluate.
   * @param evaluatorType - The evaluator identifier (e.g. `"hallucination"`, `"toxicity"`).
   * @param metricName - Human-readable metric label shown in the dashboard.
   */
  async eval(
    traceId: string,
    evaluatorType: string,
    metricName: string,
  ): Promise<string | null> {
    const body: EvalRequest = {
      trace_id: traceId,
      evaluator_type: evaluatorType,
      metric_name: metricName,
    }
    try {
      const resp = await globalThis.fetch(`${this.endpoint}/v1/eval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        console.warn(`[trulayer] eval trigger failed: HTTP ${resp.status}`)
        return null
      }
      const parsed = (await resp.json()) as Partial<EvalTriggerResponse>
      return typeof parsed.eval_id === 'string' ? parsed.eval_id : null
    } catch (err) {
      console.warn('[trulayer] eval trigger failed:', err)
      return null
    }
  }

  flush(): void {
    this._batch.flush()
  }

  shutdown(): Promise<void> {
    return this._batch.shutdown()
  }
}
