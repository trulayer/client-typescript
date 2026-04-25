import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  assertSender,
  TraceAssertions,
  SenderAssertions,
} from '../../src/testing.js'
import { LocalBatchSender } from '../../src/local-batch.js'
import { TruLayer } from '../../src/client.js'
import type { TraceData, SpanData } from '../../src/model.js'

describe('createTestClient', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    TruLayer._localWarned = false
  })

  it('returns a client paired with a LocalBatchSender', () => {
    const { client, sender } = createTestClient()
    expect(client).toBeInstanceOf(TruLayer)
    expect(sender).toBeInstanceOf(LocalBatchSender)
  })

  it('accepts partial config overrides', () => {
    const { client } = createTestClient({ projectName: 'override' })
    expect(client.projectName).toBe('override')
  })

  it('captures traces through the paired sender', async () => {
    const { client, sender } = createTestClient()
    await client.trace('outer', async (t) => {
      await t.span('inner', 'other', async () => {})
    })
    client.flush()
    expect(sender.traces).toHaveLength(1)
    expect(sender.spans).toHaveLength(1)
  })
})

describe('assertSender — SenderAssertions', () => {
  it('hasTrace() returns a TraceAssertions when traces exist', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    const result = assertSender(sender).hasTrace()
    expect(result).toBeInstanceOf(TraceAssertions)
  })

  it('hasTrace() throws a descriptive error when no traces captured', () => {
    const sender = new LocalBatchSender()
    expect(() => assertSender(sender).hasTrace()).toThrow(
      /at least one trace/,
    )
  })

  it('hasTrace(id) returns TraceAssertions scoped to the named trace', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('a', [makeSpan('sa', 'a', 'first')]))
    sender.enqueue(makeTrace('b', [makeSpan('sb', 'b', 'second')]))
    expect(() => assertSender(sender).hasTrace('b').hasSpanNamed('second')).not.toThrow()
    expect(() => assertSender(sender).hasTrace('b').hasSpanNamed('first')).toThrow()
  })

  it('hasTrace(id) throws when the id is missing', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('a', []))
    expect(() => assertSender(sender).hasTrace('nope')).toThrow(
      /to contain trace nope/,
    )
  })

  it('spanCount() checks the total across traces', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    sender.enqueue(makeTrace('t-2', [makeSpan('s-2', 't-2'), makeSpan('s-3', 't-2')]))
    expect(() => assertSender(sender).spanCount(3)).not.toThrow()
    expect(() => assertSender(sender).spanCount(2)).toThrow(/3/)
  })

  it('hasSpanNamed() looks across every trace', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1', 'alpha')]))
    sender.enqueue(makeTrace('t-2', [makeSpan('s-2', 't-2', 'beta')]))
    expect(() => assertSender(sender).hasSpanNamed('alpha')).not.toThrow()
    expect(() => assertSender(sender).hasSpanNamed('beta')).not.toThrow()
    expect(() => assertSender(sender).hasSpanNamed('gamma')).toThrow(/gamma/)
  })

  it('returns a SenderAssertions instance from assertSender', () => {
    const sender = new LocalBatchSender()
    expect(assertSender(sender)).toBeInstanceOf(SenderAssertions)
  })
})

describe('TraceAssertions', () => {
  it('spanCount() enforces the per-trace count', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1'), makeSpan('s-2', 't-1')]))
    expect(() => assertSender(sender).hasTrace().spanCount(2)).not.toThrow()
    expect(() => assertSender(sender).hasTrace().spanCount(1)).toThrow(
      /to have 1 span/,
    )
  })

  it('hasSpanNamed() surfaces observed span names in the error message', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(
      makeTrace('t-1', [makeSpan('s-1', 't-1', 'alpha'), makeSpan('s-2', 't-1', 'beta')]),
    )
    expect(() => assertSender(sender).hasTrace().hasSpanNamed('alpha')).not.toThrow()
    expect(() => assertSender(sender).hasTrace().hasSpanNamed('gamma')).toThrow(
      /alpha, beta/,
    )
  })

  it('hasAttribute() matches span metadata', () => {
    const span = makeSpan('s-1', 't-1')
    span.metadata = { 'gen_ai.system': 'openai', retries: 2 }
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [span]))
    expect(() =>
      assertSender(sender).hasTrace().hasAttribute('gen_ai.system', 'openai'),
    ).not.toThrow()
    expect(() => assertSender(sender).hasTrace().hasAttribute('retries', 2)).not.toThrow()
    expect(() =>
      assertSender(sender).hasTrace().hasAttribute('gen_ai.system', 'anthropic'),
    ).toThrow()
  })

  it('hasAttribute() falls back to well-known top-level fields', () => {
    const span = makeSpan('s-1', 't-1', 'llm')
    span.model = 'gpt-4o'
    span.prompt_tokens = 42
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [span]))
    expect(() =>
      assertSender(sender).hasTrace().hasAttribute('model', 'gpt-4o'),
    ).not.toThrow()
    expect(() =>
      assertSender(sender).hasTrace().hasAttribute('prompt_tokens', 42),
    ).not.toThrow()
    expect(() =>
      assertSender(sender).hasTrace().hasAttribute('model', 'gpt-3.5'),
    ).toThrow()
  })

  it('hasAttribute() deep-equals object values', () => {
    const span = makeSpan('s-1', 't-1')
    span.metadata = { nested: { a: 1, b: [2, 3] } }
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [span]))
    expect(() =>
      assertSender(sender)
        .hasTrace()
        .hasAttribute('nested', { a: 1, b: [2, 3] }),
    ).not.toThrow()
    expect(() =>
      assertSender(sender)
        .hasTrace()
        .hasAttribute('nested', { a: 1, b: [2, 4] }),
    ).toThrow()
  })

  it('assertions chain fluently', () => {
    const sender = new LocalBatchSender()
    const span = makeSpan('s-1', 't-1', 'llm')
    span.model = 'gpt-4o'
    span.metadata = { 'gen_ai.system': 'openai' }
    sender.enqueue(makeTrace('t-1', [span]))
    expect(() =>
      assertSender(sender)
        .hasTrace('t-1')
        .spanCount(1)
        .hasSpanNamed('llm')
        .hasAttribute('gen_ai.system', 'openai')
        .hasAttribute('model', 'gpt-4o'),
    ).not.toThrow()
  })
})

// ---- helpers ----

function makeSpan(id: string, traceId: string, name = 'test-span'): SpanData {
  return {
    id,
    trace_id: traceId,
    name,
    span_type: 'other',
    input: null,
    output: null,
    error: false,
    error_message: null,
    latency_ms: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    metadata: {},
    started_at: new Date().toISOString(),
    ended_at: null,
  }
}

function makeTrace(id: string, spans: SpanData[]): TraceData {
  return {
    id,
    project_id: 'test',
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
    tags: [],
    metadata: {},
    spans,
    started_at: new Date().toISOString(),
    ended_at: null,
  }
}
