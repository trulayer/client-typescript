import type { TraceData } from './model.js'

const MAX_RETRIES = 3
const RETRY_BASE_MS = 500

export class BatchSender {
  private buffer: TraceData[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly batchSize: number,
    private readonly flushInterval: number,
  ) {
    this.scheduleFlush()
  }

  enqueue(trace: TraceData): void {
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
    const items = this.buffer.splice(0)
    if (items.length > 0) {
      // Fire-and-forget — never blocks the caller
      void this.sendWithRetry(items)
    }
    this.scheduleFlush()
  }

  shutdown(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const items = this.buffer.splice(0)
    if (items.length === 0) return Promise.resolve()
    return this.sendWithRetry(items)
  }

  private scheduleFlush(): void {
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
        body: JSON.stringify({ traces: items }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    } catch (err) {
      if (attempt >= MAX_RETRIES - 1) {
        console.warn(
          `[trulayer] failed to send batch of ${items.length} traces after ${MAX_RETRIES} retries:`,
          err,
        )
        return
      }
      const delay = RETRY_BASE_MS * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
      return this.sendWithRetry(items, attempt + 1)
    }
  }
}
