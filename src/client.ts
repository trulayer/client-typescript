import type { FeedbackData, SpanType, TruLayerConfig } from './model.js'
import { BatchSender } from './batch.js'
import { TraceContext } from './trace.js'

const DEFAULT_ENDPOINT = 'https://api.trulayer.ai'
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_FLUSH_INTERVAL = 2000

export class TruLayer {
  /** Project label sent on every trace. Despite the legacy field name on the
   *  wire (`project_id`), this is a human-readable name that the backend
   *  resolves against the API key's tenant. */
  readonly projectName: string
  /** @deprecated Use {@link TruLayer.projectName}. */
  get projectId(): string {
    return this.projectName
  }
  /** @internal */
  readonly _batch: BatchSender
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(config: TruLayerConfig) {
    if (!config.apiKey) throw new Error('[trulayer] apiKey is required')
    const name = config.projectName ?? config.projectId
    if (!name) throw new Error('[trulayer] projectName is required')
    if (config.projectId && !config.projectName) {
      console.warn(
        '[trulayer] `projectId` is deprecated; rename to `projectName`. Will be removed in 0.3.x.',
      )
    }

    this.apiKey = config.apiKey
    this.projectName = name
    this.endpoint = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')
    this._batch = new BatchSender(
      this.apiKey,
      this.endpoint,
      config.batchSize ?? DEFAULT_BATCH_SIZE,
      config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
    )
  }

  async trace<T>(
    name: string,
    callback: (trace: TraceContext) => Promise<T>,
    options?: {
      sessionId?: string
      externalId?: string
      tags?: string[]
      metadata?: Record<string, unknown>
    },
  ): Promise<T> {
    const ctx = new TraceContext(
      this._batch,
      this.projectName,
      name,
      options?.sessionId,
      options?.tags,
      options?.metadata,
      options?.externalId,
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

  flush(): void {
    this._batch.flush()
  }

  shutdown(): Promise<void> {
    return this._batch.shutdown()
  }
}
