import type { BatchSenderLike, TraceData, SpanData } from './model.js'

export interface CapturedBatch {
  traces: TraceData[]
  sentAt: Date
}

/**
 * In-memory batch sender for local/offline mode and testing.
 * Never makes network calls. Stores all enqueued traces so they
 * can be inspected after a test run.
 */
export class LocalBatchSender implements BatchSenderLike {
  private _batches: CapturedBatch[] = []

  enqueue(trace: TraceData): void {
    this._batches.push({ traces: [{ ...trace, spans: [...trace.spans] }], sentAt: new Date() })
    if (
      typeof process !== 'undefined' &&
      process.env['TRULAYER_LOCAL_VERBOSE'] === '1'
    ) {
      console.log(
        `[trulayer:local] trace ${trace.id} — ${trace.spans.length} span(s)`,
      )
    }
  }

  flush(): void {
    // Nothing to flush — data is already stored synchronously.
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }

  /** Return all captured traces across all batches (flat). */
  get traces(): TraceData[] {
    return this._batches.flatMap((b) => b.traces)
  }

  /** Return all captured spans across all batches (flat). */
  get spans(): SpanData[] {
    return this._batches.flatMap((b) => b.traces.flatMap((t) => t.spans))
  }

  /** Return all captured batches. */
  get batches(): readonly CapturedBatch[] {
    return this._batches
  }

  /** Clear captured data. */
  clear(): void {
    this._batches = []
  }
}
