/**
 * Wire-shape contract tests.
 *
 * Verifies the exact JSON payload the SDK produces before it reaches the
 * network layer. In-memory SDK shapes keep ergonomic field names; the
 * network wire shape (what the backend sees) is what these tests lock down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer } from '../../src/client.js'
import type { TraceData, TraceWire } from '../../src/model.js'
import { traceToWire, spanToWire } from '../../src/model.js'

function captureEnqueued(tl: TruLayer): TraceData[] {
  const captured: TraceData[] = []
  vi.spyOn(tl._batch, 'enqueue').mockImplementation((t: TraceData) => {
    captured.push(t)
  })
  return captured
}

function makeClient(): TruLayer {
  return new TruLayer({ apiKey: 'tl_test', projectName: 'proj-wire' })
}

describe('span wire shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renames span_type → type, started_at → start_time, ended_at → end_time', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      await trace.span('s1', 'llm', async () => {})
    })

    expect(captured).toHaveLength(1)
    const wire = traceToWire(captured[0]!)
    expect(wire.spans).toHaveLength(1)
    const span = wire.spans[0]!

    // Fields present on the wire
    expect(span.type).toBe('llm')
    expect(typeof span.start_time).toBe('string')
    expect(typeof span.end_time).toBe('string')

    // Old names MUST NOT appear on the wire
    const keys = Object.keys(span)
    expect(keys).not.toContain('span_type')
    expect(keys).not.toContain('started_at')
    expect(keys).not.toContain('ended_at')
  })

  it('passes the in-memory error string through to the wire', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl
      .trace('t', async (trace) => {
        await trace.span('s', 'llm', async () => {
          throw new Error('boom')
        })
      })
      .catch(() => {})

    const wire = traceToWire(captured[0]!)
    const span = wire.spans[0]!

    expect(span.error).toBe('boom')
    const keys = Object.keys(span)
    expect(keys).not.toContain('error_message')
  })

  it('sets span.error to null when the span completes cleanly', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async (trace) => {
      await trace.span('s', 'llm', async () => {})
    })

    const wire = traceToWire(captured[0]!)
    expect(wire.spans[0]!.error).toBeNull()
  })

  it('preserves all data fields across the wire mapping', () => {
    const span = {
      id: 'sid',
      trace_id: 'tid',
      parent_span_id: 'pid',
      name: 'n',
      span_type: 'tool' as const,
      input: 'in',
      output: 'out',
      error: null,
      latency_ms: 42,
      model: 'gpt-4',
      prompt_tokens: 10,
      completion_tokens: 20,
      metadata: { a: 1 },
      started_at: '2025-01-01T00:00:00.000Z',
      ended_at: '2025-01-01T00:00:01.000Z',
    }
    const wire = spanToWire(span)
    expect(wire).toEqual({
      id: 'sid',
      trace_id: 'tid',
      parent_span_id: 'pid',
      name: 'n',
      type: 'tool',
      input: 'in',
      output: 'out',
      error: null,
      latency_ms: 42,
      model: 'gpt-4',
      prompt_tokens: 10,
      completion_tokens: 20,
      metadata: { a: 1 },
      start_time: '2025-01-01T00:00:00.000Z',
      end_time: '2025-01-01T00:00:01.000Z',
    })
  })

  it('omits parent_span_id when not set', () => {
    const wire = spanToWire({
      id: 'sid',
      trace_id: 'tid',
      name: 'n',
      span_type: 'other',
      input: null,
      output: null,
      error: null,
      latency_ms: null,
      model: null,
      prompt_tokens: null,
      completion_tokens: null,
      metadata: {},
      started_at: 'now',
      ended_at: null,
    })
    expect('parent_span_id' in wire).toBe(false)
  })
})

describe('trace wire shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the trace error string through to the wire', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl
      .trace('t', async () => {
        throw new Error('trace failed')
      })
      .catch(() => {})

    const wire = traceToWire(captured[0]!)
    expect(wire.error).toBe('trace failed')
    expect(Object.keys(wire)).not.toContain('error_message')
  })

  it('sets trace.error to null on success', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('t', async () => {})

    const wire = traceToWire(captured[0]!)
    expect(wire.error).toBeNull()
  })
})

describe('batch wire format', () => {
  it('POSTs traces serialised via traceToWire (type/start_time/end_time/error:string)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const tl = new TruLayer({
      apiKey: 'tl_test',
      projectName: 'proj',
      batchSize: 1,
      flushInterval: 1_000_000,
    })

    await tl
      .trace('t', async (trace) => {
        await trace.span('s', 'llm', async () => {
          throw new Error('x')
        })
      })
      .catch(() => {})

    // Batch flush is fire-and-forget; give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalled()
    const call = fetchMock.mock.calls[0]!
    const body = JSON.parse(call[1].body) as { traces: TraceWire[] }
    const sentSpan = body.traces[0]!.spans[0]!
    expect(sentSpan.type).toBe('llm')
    expect(typeof sentSpan.start_time).toBe('string')
    expect(sentSpan.error).toBe('x')
    expect(Object.keys(sentSpan)).not.toContain('span_type')
    expect(Object.keys(sentSpan)).not.toContain('started_at')
    expect(Object.keys(sentSpan)).not.toContain('ended_at')
    expect(Object.keys(sentSpan)).not.toContain('error_message')

    await tl.shutdown()
  })
})

describe('eval()', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs {trace_id, evaluator_type, metric_name} and returns eval_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ eval_id: 'ev-1', status: 'pending' }) })
    vi.stubGlobal('fetch', fetchMock)

    const tl = new TruLayer({ apiKey: 'tl_test', projectName: 'proj' })
    const evalId = await tl.eval('trace-123', 'hallucination', 'answer-grounded')

    expect(evalId).toBe('ev-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(/\/v1\/eval$/)
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer tl_test')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      trace_id: 'trace-123',
      evaluator_type: 'hallucination',
      metric_name: 'answer-grounded',
    })
  })

  it('returns null and never throws on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tl = new TruLayer({ apiKey: 'tl_test', projectName: 'proj' })
    const evalId = await tl.eval('trace-1', 'toxicity', 'tox')

    expect(evalId).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null and never throws on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tl = new TruLayer({ apiKey: 'tl_test', projectName: 'proj' })
    const evalId = await tl.eval('trace-1', 'toxicity', 'tox')

    expect(evalId).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})
