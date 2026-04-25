import type { SpanData, TraceData, TruLayerConfig } from './model.js'
import { TruLayer } from './client.js'
import { LocalBatchSender } from './local-batch.js'

/**
 * Create a TruLayer client wired to an in-memory {@link LocalBatchSender}.
 *
 * No API key or project name is required — the returned client is safe to
 * use in unit tests without reaching the network. Pass `config` overrides
 * to exercise sampling, redaction, or other client behavior under test.
 *
 * @example
 * const { client, sender } = createTestClient()
 * await client.trace('my-test', async (t) => {
 *   await t.span('step-1', 'other', async () => {})
 * })
 * client.flush()
 * assertSender(sender).hasTrace().spanCount(1).hasSpanNamed('step-1')
 */
export function createTestClient(config?: Partial<TruLayerConfig>): {
  client: TruLayer
  sender: LocalBatchSender
} {
  const sender = new LocalBatchSender()
  const client = new TruLayer(
    { apiKey: 'test-key', projectName: 'test', ...config },
    sender,
  )
  return { client, sender }
}

/**
 * Fluent assertions scoped to a single captured trace. Created by
 * {@link SenderAssertions.hasTrace}.
 *
 * All methods return `this` for chaining. Any failing assertion throws a
 * plain `Error` so the helpers stay framework-agnostic (Vitest, Jest,
 * Mocha all surface thrown errors as failures without any adapter).
 */
export class TraceAssertions {
  constructor(private readonly trace: TraceData) {}

  /** Assert the trace contains exactly `n` spans. */
  spanCount(n: number): this {
    if (this.trace.spans.length !== n) {
      throw new Error(
        `Expected trace ${this.trace.id} to have ${n} span(s), got ${this.trace.spans.length}`,
      )
    }
    return this
  }

  /** Assert the trace contains a span with the given name. */
  hasSpanNamed(name: string): this {
    const found = this.trace.spans.some((s) => s.name === name)
    if (!found) {
      const names = this.trace.spans.map((s) => s.name).join(', ') || '<none>'
      throw new Error(
        `Expected trace ${this.trace.id} to have span named "${name}"; got: ${names}`,
      )
    }
    return this
  }

  /**
   * Assert that at least one span in the trace carries the given attribute.
   *
   * Looks up the key on the span's `metadata` first; if not present, also
   * checks a small set of top-level span fields (`model`, `name`,
   * `span_type`, `prompt_tokens`, `completion_tokens`) so assertions like
   * `hasAttribute('model', 'gpt-4o')` work without knowing whether the
   * instrumenter wrote it to metadata or the dedicated field.
   */
  hasAttribute(key: string, value: unknown): this {
    const match = this.trace.spans.some((s) => spanAttributeMatches(s, key, value))
    if (!match) {
      throw new Error(
        `Expected trace ${this.trace.id} to have a span with attribute "${key}"=${JSON.stringify(
          value,
        )}`,
      )
    }
    return this
  }
}

/**
 * Fluent assertions over all traces captured by a {@link LocalBatchSender}.
 * Created by {@link assertSender}.
 */
export class SenderAssertions {
  constructor(private readonly sender: LocalBatchSender) {}

  /**
   * Assert the sender captured at least one trace (or a specific trace ID
   * when provided). Returns a {@link TraceAssertions} scoped to the matched
   * trace so callers can chain per-trace assertions.
   */
  hasTrace(traceId?: string): TraceAssertions {
    if (traceId !== undefined) {
      const found = this.sender.traces.find((t) => t.id === traceId)
      if (!found) {
        throw new Error(`Expected sender to contain trace ${traceId}, not found`)
      }
      return new TraceAssertions(found)
    }
    if (this.sender.traces.length === 0) {
      throw new Error('Expected sender to contain at least one trace, got none')
    }
    // Default: assert on the most recent trace captured.
    const latest = this.sender.traces[this.sender.traces.length - 1] as TraceData
    return new TraceAssertions(latest)
  }

  /** Assert the total number of spans across all captured traces. */
  spanCount(n: number): this {
    if (this.sender.spans.length !== n) {
      throw new Error(
        `Expected sender to have ${n} span(s) total, got ${this.sender.spans.length}`,
      )
    }
    return this
  }

  /** Assert at least one captured span has the given name. */
  hasSpanNamed(name: string): this {
    const found = this.sender.spans.some((s) => s.name === name)
    if (!found) {
      throw new Error(`Expected span named "${name}" not found`)
    }
    return this
  }
}

/**
 * Entry point for the fluent assertion chain. Use with
 * {@link createTestClient} to write framework-agnostic SDK tests.
 *
 * @example
 * const { client, sender } = createTestClient()
 * await client.trace('rag', async (t) => {
 *   await t.span('retrieve', 'retrieval', async (s) => {
 *     s.setMetadata({ 'gen_ai.system': 'openai' })
 *   })
 * })
 * client.flush()
 * assertSender(sender).hasTrace().spanCount(1).hasAttribute('gen_ai.system', 'openai')
 */
export function assertSender(sender: LocalBatchSender): SenderAssertions {
  return new SenderAssertions(sender)
}

function spanAttributeMatches(span: SpanData, key: string, value: unknown): boolean {
  // Metadata is the canonical location for attributes written via
  // `span.setMetadata({...})` and by auto-instrumenters following the GenAI
  // semantic conventions.
  if (Object.prototype.hasOwnProperty.call(span.metadata, key)) {
    if (deepEqual(span.metadata[key], value)) return true
  }
  // Fall back to well-known top-level fields so callers can write
  // ergonomic assertions without caring about the storage location.
  const topLevel: Record<string, unknown> = {
    model: span.model,
    name: span.name,
    span_type: span.span_type,
    prompt_tokens: span.prompt_tokens,
    completion_tokens: span.completion_tokens,
  }
  if (Object.prototype.hasOwnProperty.call(topLevel, key)) {
    if (deepEqual(topLevel[key], value)) return true
  }
  return false
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a as object)
  const bKeys = Object.keys(b as object)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false
    }
  }
  return true
}

export { LocalBatchSender } from './local-batch.js'
export type { CapturedBatch } from './local-batch.js'
