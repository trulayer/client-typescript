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

  /**
   * Serialize every captured trace to a JSONL file — one {@link TraceData}
   * JSON object per line. The resulting file can be replayed later with
   * {@link replay} to reproduce the captured sequence in a fresh sender.
   *
   * Node-only (uses `node:fs/promises`). No-op paths / errors bubble up to
   * the caller so test harnesses can react; this is not part of the
   * never-throws runtime contract since it is called explicitly by tools,
   * not by user application code.
   */
  async flushToFile(path: string): Promise<void> {
    const { writeFile } = await import('node:fs/promises')
    const lines = this.traces.map((t) => JSON.stringify(t))
    // Trailing newline keeps the file `cat`-friendly and makes streaming
    // readers (`for await (const line of rl)`) yield the last record.
    const body = lines.length === 0 ? '' : lines.join('\n') + '\n'
    await writeFile(path, body, 'utf8')
  }
}
