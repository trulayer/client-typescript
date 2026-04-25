import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LocalBatchSender } from '../../src/local-batch.js'
import { TruLayer } from '../../src/client.js'
import { createTestClient, assertSender } from '../../src/testing.js'

describe('LocalBatchSender', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    TruLayer._localWarned = false
  })

  it('enqueue() stores traces without throwing', () => {
    const sender = new LocalBatchSender()
    const trace = makeTrace('t-1', [makeSpan('s-1', 't-1')])
    expect(() => sender.enqueue(trace)).not.toThrow()
    expect(sender.traces).toHaveLength(1)
  })

  it('traces returns flat list across multiple enqueue calls', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', []))
    sender.enqueue(makeTrace('t-2', []))
    sender.enqueue(makeTrace('t-3', []))
    expect(sender.traces).toHaveLength(3)
    expect(sender.traces.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3'])
  })

  it('spans returns flat spans across all traces', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1'), makeSpan('s-2', 't-1')]))
    sender.enqueue(makeTrace('t-2', [makeSpan('s-3', 't-2')]))
    expect(sender.spans).toHaveLength(3)
    expect(sender.spans.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])
  })

  it('clear() empties all state', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    expect(sender.traces).toHaveLength(1)
    sender.clear()
    expect(sender.traces).toHaveLength(0)
    expect(sender.spans).toHaveLength(0)
    expect(sender.batches).toHaveLength(0)
  })
})

describe('createTestClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    TruLayer._localWarned = false
  })

  it('returns client and sender', () => {
    const { client, sender } = createTestClient()
    expect(client).toBeInstanceOf(TruLayer)
    expect(sender).toBeInstanceOf(LocalBatchSender)
  })

  it('after trace + flush, sender has spans', async () => {
    const { client, sender } = createTestClient()
    await client.trace('test-trace', async (t) => {
      await t.span('step-1', 'other', async () => {})
      await t.span('step-2', 'llm', async (s) => {
        s.setModel('gpt-4o')
      })
    })
    client.flush()
    expect(sender.traces).toHaveLength(1)
    expect(sender.spans).toHaveLength(2)
    expect(sender.spans.map((s) => s.name)).toContain('step-1')
    expect(sender.spans.map((s) => s.name)).toContain('step-2')
  })

  it('constructor uses LocalBatchSender when TRULAYER_MODE=local', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env['TRULAYER_MODE'] = 'local'
    try {
      const client = new TruLayer({ apiKey: '', projectName: '' })
      expect(client._batch).toBeInstanceOf(LocalBatchSender)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('LOCAL mode'),
      )
    } finally {
      delete process.env['TRULAYER_MODE']
    }
  })
})

describe('assertSender', () => {
  it('hasTrace() passes when trace present', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', []))
    expect(() => assertSender(sender).hasTrace()).not.toThrow()
    expect(() => assertSender(sender).hasTrace('t-1')).not.toThrow()
  })

  it('spanCount(n) throws when count mismatch', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1')]))
    expect(() => assertSender(sender).spanCount(1)).not.toThrow()
    expect(() => assertSender(sender).spanCount(5)).toThrow(/5 span\(s\) total, got 1/)
  })

  it('hasSpanNamed() throws when span not found', () => {
    const sender = new LocalBatchSender()
    sender.enqueue(makeTrace('t-1', [makeSpan('s-1', 't-1', 'my-span')]))
    expect(() => assertSender(sender).hasSpanNamed('my-span')).not.toThrow()
    expect(() => assertSender(sender).hasSpanNamed('no-such-span')).toThrow(
      'Expected span named "no-such-span" not found',
    )
  })
})

// ---- helpers ----

function makeSpan(id: string, traceId: string, name = 'test-span') {
  return {
    id,
    trace_id: traceId,
    name,
    span_type: 'other' as const,
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

function makeTrace(id: string, spans: ReturnType<typeof makeSpan>[]) {
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
    tags: [],
    metadata: {},
    spans,
    started_at: new Date().toISOString(),
    ended_at: null,
  }
}
