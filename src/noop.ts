import type { SpanType } from './model.js'

/**
 * No-op span context returned when a trace is sampled out.
 * All methods are silent no-ops; nothing is enqueued.
 */
export class NoopSpanContext {
  /** Minimal data stub so callers that read `.data.id` don't crash. */
  readonly data = Object.freeze({
    id: '',
    trace_id: '',
    name: '',
    span_type: 'default' as const,
    input: null,
    output: null,
    error: false,
    error_message: null,
    latency_ms: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    metadata: {},
    started_at: '',
    ended_at: null,
  })

  setInput(_value: string): this {
    return this
  }

  setOutput(_value: string): this {
    return this
  }

  setModel(_model: string): this {
    return this
  }

  setTokens(_prompt?: number, _completion?: number): this {
    return this
  }

  setMetadata(_meta: Record<string, unknown>): this {
    return this
  }

  async span<T>(
    _name: string,
    _spanType: SpanType,
    callback: (span: NoopSpanContext) => Promise<T>,
  ): Promise<T> {
    return callback(new NoopSpanContext())
  }
}

/**
 * No-op trace context returned when a trace is sampled out.
 * The user callback still executes, but nothing is sent to TruLayer.
 */
export class NoopTraceContext {
  /** Minimal data stub so callers that read `.data.id` don't crash. */
  readonly data = Object.freeze({
    id: '',
    project_id: '',
    session_id: null,
    external_id: null,
    name: null,
    input: null,
    output: null,
    model: null,
    latency_ms: null,
    cost: null,
    error: false,
    error_message: null,
    tags: [] as string[],
    metadata: {},
    spans: [] as never[],
    started_at: '',
    ended_at: null,
  })

  setModel(_model: string): this {
    return this
  }

  setCost(_cost: number): this {
    return this
  }

  setInput(_value: string): this {
    return this
  }

  setOutput(_value: string): this {
    return this
  }

  setMetadata(_meta: Record<string, unknown>): this {
    return this
  }

  addTag(_tag: string): this {
    return this
  }

  async span<T>(
    _name: string,
    _spanType: SpanType,
    callback: (span: NoopSpanContext) => Promise<T>,
    _explicitParentId?: string,
  ): Promise<T> {
    return callback(new NoopSpanContext())
  }
}
