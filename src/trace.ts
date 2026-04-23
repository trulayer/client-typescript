import type { BatchSenderLike } from './model.js'
import type { SpanData, SpanType, TraceData } from './model.js'
import { newId } from './ids.js'

function nowISO(): string {
  return new Date().toISOString()
}

// --- AsyncLocalStorage for automatic parent span propagation ---
// Edge runtimes may not have AsyncLocalStorage; we feature-detect lazily
// and fall back to no automatic nesting (parent_span_id omitted).

interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

let spanStorage: AsyncLocalStorageLike<SpanContext> | null = null
let spanStorageResolved = false
let spanStorageInitPromise: Promise<void> | null = null

function getSpanStorage(): AsyncLocalStorageLike<SpanContext> | null {
  if (spanStorageResolved) return spanStorage
  // Kick off async init if not started yet — first call may return null,
  // but subsequent calls (after the microtask resolves) will have the storage.
  if (!spanStorageInitPromise) {
    spanStorageInitPromise = initSpanStorage()
  }
  return spanStorage
}

async function initSpanStorage(): Promise<void> {
  if (spanStorageResolved) return
  try {
    // Try globalThis first (Bun, Deno, some Edge runtimes expose it globally)
    const g = globalThis as unknown as {
      AsyncLocalStorage?: new <T>() => AsyncLocalStorageLike<T>
    }
    if (typeof g.AsyncLocalStorage === 'function') {
      spanStorage = new g.AsyncLocalStorage<SpanContext>()
      spanStorageResolved = true
      return
    }

    // Node.js ESM: dynamic import of node:async_hooks
    if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
      const asyncHooks = await import('node:async_hooks')
      if (asyncHooks?.AsyncLocalStorage) {
        spanStorage = new asyncHooks.AsyncLocalStorage<SpanContext>()
      }
    }
  } catch {
    // Edge runtime / environments without AsyncLocalStorage — fall back gracefully
  }
  spanStorageResolved = true
}

/**
 * Ensure AsyncLocalStorage is initialized. Call this once early (e.g., in
 * TruLayer constructor) so that span nesting works on the first trace.
 * @internal
 */
export async function _ensureSpanStorage(): Promise<void> {
  if (spanStorageResolved) return
  if (!spanStorageInitPromise) {
    spanStorageInitPromise = initSpanStorage()
  }
  await spanStorageInitPromise
}

/** @internal Exposed for testing: override or clear the span storage. */
export function _setSpanStorage(s: AsyncLocalStorageLike<SpanContext> | null): void {
  spanStorage = s
  spanStorageResolved = true
}

/** @internal Exposed for testing: reset lazy resolution. */
export function _resetSpanStorage(): void {
  spanStorage = null
  spanStorageResolved = false
  spanStorageInitPromise = null
}

function currentParentSpanId(): string | undefined {
  return getSpanStorage()?.getStore()?.data.id
}

export class SpanContext {
  readonly data: SpanData
  private readonly traceContext: TraceContext
  private readonly redact: ((data: unknown) => unknown) | undefined

  constructor(
    traceContext: TraceContext,
    name: string,
    spanType: SpanType = 'default',
    parentSpanId?: string,
    redact?: (data: unknown) => unknown,
  ) {
    this.traceContext = traceContext
    this.redact = redact
    this.data = {
      id: newId(),
      trace_id: traceContext.data.id,
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
    if (parentSpanId !== undefined) {
      this.data.parent_span_id = parentSpanId
    }
  }

  setInput(value: string): this {
    if (this.redact) {
      try {
        const redacted = this.redact(value)
        this.data.input = redacted as string | null
      } catch {
        console.warn('[trulayer] redact callback threw on input; storing null')
        this.data.input = null
      }
    } else {
      this.data.input = value
    }
    return this
  }

  setOutput(value: string): this {
    if (this.redact) {
      try {
        const redacted = this.redact(value)
        this.data.output = redacted as string | null
      } catch {
        console.warn('[trulayer] redact callback threw on output; storing null')
        this.data.output = null
      }
    } else {
      this.data.output = value
    }
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

  /**
   * Create a child span nested under this span.
   * The child's `parent_span_id` is set to this span's ID.
   */
  async span<T>(
    name: string,
    spanType: SpanType,
    callback: (span: SpanContext) => Promise<T>,
  ): Promise<T> {
    return this.traceContext.span(name, spanType, callback, this.data.id)
  }
}

export class TraceContext {
  readonly data: TraceData
  private startMs: number
  private readonly redact: ((data: unknown) => unknown) | undefined

  constructor(
    private readonly batch: BatchSenderLike,
    readonly projectId: string,
    name?: string,
    sessionId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    externalId?: string,
    redact?: (data: unknown) => unknown,
  ) {
    this.startMs = Date.now()
    this.redact = redact
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
      error_message: null,
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
    if (this.redact) {
      try {
        const redacted = this.redact(value)
        this.data.input = redacted as string | null
      } catch {
        console.warn('[trulayer] redact callback threw on input; storing null')
        this.data.input = null
      }
    } else {
      this.data.input = value
    }
    return this
  }

  setOutput(value: string): this {
    if (this.redact) {
      try {
        const redacted = this.redact(value)
        this.data.output = redacted as string | null
      } catch {
        console.warn('[trulayer] redact callback threw on output; storing null')
        this.data.output = null
      }
    } else {
      this.data.output = value
    }
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
    explicitParentId?: string,
  ): Promise<T> {
    // Resolve parent: explicit > AsyncLocalStorage > undefined (top-level)
    const parentSpanId = explicitParentId ?? currentParentSpanId()
    const span = new SpanContext(this, name, spanType, parentSpanId, this.redact)
    const startMs = Date.now()

    const runCallback = async (): Promise<T> => {
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

    // Run inside AsyncLocalStorage if available, so nested spans auto-detect parent
    const storage = getSpanStorage()
    if (storage) {
      return storage.run(span, runCallback)
    }
    return runCallback()
  }

  finish(error?: unknown): void {
    this.data.ended_at = nowISO()
    if (this.data.latency_ms === null) {
      this.data.latency_ms = Date.now() - this.startMs
    }
    if (error !== undefined) {
      this.data.error = true
      this.data.error_message = error instanceof Error ? error.message : String(error)
    }
    try {
      this.batch.enqueue(this.data)
    } catch {
      // Never throw from SDK internals
    }
  }
}
