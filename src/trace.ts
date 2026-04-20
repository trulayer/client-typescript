import type { SpanData, SpanType, TraceData } from './model.js'
import { newId } from './ids.js'
import type { BatchSender } from './batch.js'

function nowISO(): string {
  return new Date().toISOString()
}

export class SpanContext {
  readonly data: SpanData

  constructor(
    readonly traceId: string,
    name: string,
    spanType: SpanType = 'default',
  ) {
    this.data = {
      id: newId(),
      trace_id: traceId,
      name,
      span_type: spanType,
      input: null,
      output: null,
      error: false,
      error_message: null,
      latency_ms: null,
      model: null,
      prompt_tokens: null,
      completion_tokens: null,
      metadata: {},
      started_at: nowISO(),
      ended_at: null,
    }
  }

  setInput(value: string): this {
    this.data.input = value
    return this
  }

  setOutput(value: string): this {
    this.data.output = value
    return this
  }

  setModel(model: string): this {
    this.data.model = model
    return this
  }

  setTokens(prompt?: number, completion?: number): this {
    if (prompt !== undefined) this.data.prompt_tokens = prompt
    if (completion !== undefined) this.data.completion_tokens = completion
    return this
  }

  setMetadata(meta: Record<string, unknown>): this {
    Object.assign(this.data.metadata, meta)
    return this
  }
}

export class TraceContext {
  readonly data: TraceData
  private startMs: number

  constructor(
    private readonly batch: BatchSender,
    readonly projectId: string,
    name?: string,
    sessionId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    externalId?: string,
  ) {
    this.startMs = Date.now()
    this.data = {
      id: newId(),
      project_id: projectId,
      session_id: sessionId ?? null,
      external_id: externalId ?? null,
      name: name ?? null,
      input: null,
      output: null,
      model: null,
      latency_ms: null,
      cost: null,
      error: false,
      tags: tags ?? [],
      metadata: metadata ?? {},
      spans: [],
      started_at: nowISO(),
      ended_at: null,
    }
  }

  setModel(model: string): this {
    this.data.model = model
    return this
  }

  setCost(cost: number): this {
    this.data.cost = cost
    return this
  }

  setInput(value: string): this {
    this.data.input = value
    return this
  }

  setOutput(value: string): this {
    this.data.output = value
    return this
  }

  setMetadata(meta: Record<string, unknown>): this {
    Object.assign(this.data.metadata, meta)
    return this
  }

  addTag(tag: string): this {
    this.data.tags.push(tag)
    return this
  }

  async span<T>(
    name: string,
    spanType: SpanType,
    callback: (span: SpanContext) => Promise<T>,
  ): Promise<T> {
    const span = new SpanContext(this.data.id, name, spanType)
    const startMs = Date.now()
    try {
      return await callback(span)
    } catch (err) {
      span.data.error = true
      span.data.error_message = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      span.data.latency_ms = Date.now() - startMs
      span.data.ended_at = nowISO()
      this.data.spans.push(span.data)
    }
  }

  finish(error?: unknown): void {
    this.data.ended_at = nowISO()
    if (this.data.latency_ms === null) {
      this.data.latency_ms = Date.now() - this.startMs
    }
    if (error !== undefined) this.data.error = true
    try {
      this.batch.enqueue(this.data)
    } catch {
      // Never throw from SDK internals
    }
  }
}
