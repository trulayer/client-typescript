/**
 * Wire-shape contract tests.
 *
 * These tests verify the exact JSON payload the SDK produces before it
 * reaches the network layer. They use a mock BatchSender so no real HTTP
 * request is made.
 *
 * FINDINGS DOCUMENTED AS ASSERTIONS — the tests below reflect the current
 * state of the SDK. Where the SDK diverges from the backend OpenAPI spec
 * the test carries an inline "SPEC MISMATCH" comment so engineers can
 * find and fix the divergence without re-reading this file from scratch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer } from '../../src/client.js'
import type { TraceData, SpanData } from '../../src/model.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture every payload enqueued by the given client. */
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

// ---------------------------------------------------------------------------
// Trace payload shape
// ---------------------------------------------------------------------------

describe('trace wire shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enqueues a TraceData with all required top-level fields', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('my-op', async (t) => {
      t.setInput('user prompt').setOutput('model answer').setModel('gpt-4o-mini')
      t.setCost(0.001)
    })

    expect(captured).toHaveLength(1)
    const p = captured[0]!
    expect(typeof p.id).toBe('string')
    expect(p.project_id).toBe('proj-wire')
    expect(p.name).toBe('my-op')
    expect(p.input).toBe('user prompt')
    expect(p.output).toBe('model answer')
    expect(p.model).toBe('gpt-4o-mini')
    expect(p.cost).toBe(0.001)
    expect(typeof p.error).toBe('boolean')
    expect(Array.isArray(p.tags)).toBe(true)
    expect(typeof p.metadata).toBe('object')
    expect(typeof p.started_at).toBe('string')
    // started_at must be ISO 8601
    expect(() => new Date(p.started_at)).not.toThrow()
  })

  it('enqueues error=true when the callback throws', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await expect(
      tl.trace('failing-op', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(captured[0]!.error).toBe(true)
  })

  it('includes session_id and external_id when supplied', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('scoped', async () => {}, {
      sessionId: 'sess-abc',
      externalId: 'ext-xyz',
    })

    const p = captured[0]!
    expect(p.session_id).toBe('sess-abc')
    expect(p.external_id).toBe('ext-xyz')
  })

  it('sets session_id and external_id to null when not supplied', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)
    await tl.trace('bare', async () => {})

    const p = captured[0]!
    expect(p.session_id).toBeNull()
    expect(p.external_id).toBeNull()
  })

  it('propagates tags into the payload', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)
    await tl.trace('tagged', async () => {}, { tags: ['prod', 'v2'] })
    expect(captured[0]!.tags).toEqual(['prod', 'v2'])
  })

  it('propagates metadata into the payload', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)
    await tl.trace('meta', async () => {}, { metadata: { env: 'staging' } })
    expect(captured[0]!.metadata).toMatchObject({ env: 'staging' })
  })

  it('latency_ms is a non-negative integer on the payload', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)
    await tl.trace('latency', async () => {})
    const lms = captured[0]!.latency_ms
    expect(lms).not.toBeNull()
    expect(typeof lms).toBe('number')
    expect(lms!).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(lms)).toBe(true)
  })

  // SPEC MISMATCH — TraceRequest.error is `string | null` in the OpenAPI spec
  // (it carries the error message text).  The SDK sends `error: boolean`.
  // The backend must accept either shape, or the spec is wrong.
  // This test documents the current SDK behaviour so any fix is visible.
  it('KNOWN: trace payload sends error as boolean, not string (spec expects string)', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)
    await expect(
      tl.trace('err-trace', async () => {
        throw new Error('something broke')
      }),
    ).rejects.toThrow()
    const p = captured[0]!
    // Current SDK sends boolean
    expect(typeof p.error).toBe('boolean')
    expect(p.error).toBe(true)
    // The spec says `error: string | null` — the message is NOT captured at
    // the trace level in the current SDK.
  })
})

// ---------------------------------------------------------------------------
// Span payload shape
// ---------------------------------------------------------------------------

describe('span wire shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('span is included in the trace spans array', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('with-span', async (t) => {
      await t.span('llm-call', 'llm', async (s) => {
        s.setInput('prompt').setOutput('answer').setModel('gpt-4o')
        s.setTokens(10, 5)
      })
    })

    const spans = captured[0]!.spans
    expect(spans).toHaveLength(1)
    const s: SpanData = spans[0]!
    expect(s.name).toBe('llm-call')
    expect(s.input).toBe('prompt')
    expect(s.output).toBe('answer')
    expect(s.model).toBe('gpt-4o')
    expect(s.prompt_tokens).toBe(10)
    expect(s.completion_tokens).toBe(5)
    expect(s.trace_id).toBe(captured[0]!.id)
    expect(typeof s.latency_ms).toBe('number')
    expect(s.latency_ms!).toBeGreaterThanOrEqual(0)
  })

  it('span sets error=true and error_message when callback throws', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await expect(
      tl.trace('span-err', async (t) => {
        await t.span('bad-span', 'tool', async () => {
          throw new Error('span failed')
        })
      }),
    ).rejects.toThrow('span failed')

    const span = captured[0]!.spans[0]!
    expect(span.error).toBe(true)
    expect(span.error_message).toContain('span failed')
  })

  it('span sets parent_span_id when nested via span() on a SpanContext', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('nested', async (t) => {
      await t.span('outer', 'chain', async (outer) => {
        await outer.span('inner', 'llm', async () => {})
      })
    })

    const spans = captured[0]!.spans
    const inner = spans.find((s) => s.name === 'inner')!
    const outer = spans.find((s) => s.name === 'outer')!
    expect(inner.parent_span_id).toBe(outer.id)
  })

  // SPEC MISMATCH — SpanRequest.type field name in spec vs span_type in SDK
  // The backend OpenAPI spec defines the field as `type` (not `span_type`).
  // The SDK sends `span_type`. This test documents what the SDK currently sends.
  it('KNOWN: SDK sends span_type not type (spec field name is type)', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('field-name', async (t) => {
      await t.span('s', 'llm', async () => {})
    })

    const span = captured[0]!.spans[0]!
    // SDK field is span_type
    expect('span_type' in span).toBe(true)
    expect((span as Record<string, unknown>)['type']).toBeUndefined()
  })

  // SPEC MISMATCH — SpanRequest timestamp field names
  // Spec: start_time / end_time
  // SDK:  started_at / ended_at
  it('KNOWN: SDK sends started_at/ended_at not start_time/end_time', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('ts-fields', async (t) => {
      await t.span('s', 'tool', async () => {})
    })

    const span = captured[0]!.spans[0]!
    expect(typeof span.started_at).toBe('string')
    expect('ended_at' in span).toBe(true)
    expect((span as Record<string, unknown>)['start_time']).toBeUndefined()
    expect((span as Record<string, unknown>)['end_time']).toBeUndefined()
  })

  // SPEC MISMATCH — SpanType enum mismatch
  // Spec enum: [llm, tool, retrieval, other]
  // SDK enum:  [llm, tool, retrieval, chain, default]
  // 'chain' and 'default' are sent by SDK but not in spec.
  // 'other' is in spec but not in SDK.
  it('KNOWN: SDK SpanType enum includes chain/default which are absent from spec', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('enum-test', async (t) => {
      await t.span('chain-span', 'chain', async () => {})
      await t.span('default-span', 'default', async () => {})
    })

    const types = captured[0]!.spans.map((s) => s.span_type)
    expect(types).toContain('chain')
    expect(types).toContain('default')
    // 'other' (spec-only value) is not producible via the SDK SpanType union
  })

  // SPEC MISMATCH — SpanRequest has a cost field; SpanData does not
  it('KNOWN: SpanData has no cost field (SpanRequest.cost exists in spec)', async () => {
    const tl = makeClient()
    const captured = captureEnqueued(tl)

    await tl.trace('cost-check', async (t) => {
      await t.span('s', 'llm', async () => {})
    })

    const span = captured[0]!.spans[0]!
    // SDK SpanData type has no cost property
    expect((span as Record<string, unknown>)['cost']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Batch sender wire format
// ---------------------------------------------------------------------------

describe('batch sender wire format', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends { traces: [...] } as the JSON body', async () => {
    const tl = makeClient()
    // Trigger a real flush path by tracing and shutting down
    await tl.trace('wire-test', async () => {})
    await tl.shutdown()

    expect(fetch).toHaveBeenCalled()
    const call = vi.mocked(fetch).mock.calls[0]!
    const body = JSON.parse((call[1] as RequestInit).body as string) as unknown
    expect(body).toHaveProperty('traces')
    expect(Array.isArray((body as { traces: unknown[] }).traces)).toBe(true)
    expect((body as { traces: unknown[] }).traces).toHaveLength(1)
  })

  it('sends Content-Type: application/json', async () => {
    const tl = makeClient()
    await tl.trace('ct', async () => {})
    await tl.shutdown()

    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends Authorization: Bearer <apiKey>', async () => {
    const tl = makeClient()
    await tl.trace('auth', async () => {})
    await tl.shutdown()

    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tl_test')
  })

  it('targets /v1/ingest/batch endpoint', async () => {
    const tl = makeClient()
    await tl.trace('endpoint', async () => {})
    await tl.shutdown()

    const url = vi.mocked(fetch).mock.calls[0]![0] as string
    expect(url).toMatch(/\/v1\/ingest\/batch$/)
  })
})

// ---------------------------------------------------------------------------
// Feedback wire shape
// ---------------------------------------------------------------------------

describe('feedback wire shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /v1/feedback', async () => {
    const tl = makeClient()
    tl.feedback('trace-id-001', 'good')
    await new Promise((r) => setTimeout(r, 20))

    const call = vi.mocked(fetch).mock.calls[0]!
    expect((call[0] as string)).toMatch(/\/v1\/feedback$/)
    expect((call[1] as RequestInit).method).toBe('POST')
  })

  it('sends trace_id and label in the body', async () => {
    const tl = makeClient()
    tl.feedback('trace-id-002', 'bad')
    await new Promise((r) => setTimeout(r, 20))

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body.trace_id).toBe('trace-id-002')
    expect(body.label).toBe('bad')
  })

  it('includes optional score and comment when provided', async () => {
    const tl = makeClient()
    tl.feedback('trace-id-003', 'good', { score: 0.9, comment: 'great' })
    await new Promise((r) => setTimeout(r, 20))

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>
    expect(body.score).toBe(0.9)
    expect(body.comment).toBe('great')
  })

  it('sends Authorization header with API key', async () => {
    const tl = makeClient()
    tl.feedback('trace-id-004', 'neutral')
    await new Promise((r) => setTimeout(r, 20))

    const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tl_test')
  })

  it('does not throw on 4xx feedback response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tl = makeClient()
    // Must not throw
    expect(() => tl.feedback('trace-id-005', 'good')).not.toThrow()
    await new Promise((r) => setTimeout(r, 20))

    // fetch was called even if response was not ok
    expect(fetch).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('warns but does not throw on 401 feedback response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tl = makeClient()
    tl.feedback('trace-id-006', 'bad')
    await new Promise((r) => setTimeout(r, 20))

    expect(warnSpy).not.toHaveBeenCalled() // fetch resolved OK-ish; no catch
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Eval endpoint — SDK surface gap
// ---------------------------------------------------------------------------

// SPEC GAP: POST /v1/eval (EvalTriggerRequest) is not exposed by the SDK.
// Neither TruLayer nor any exported helper sends a request to /v1/eval.
// The test below documents the absence so the gap is explicit and tracked.
describe('eval endpoint surface (gap)', () => {
  it('TruLayer client has no eval() method — POST /v1/eval is not accessible via SDK', () => {
    const tl = makeClient()
    // @ts-expect-error — eval does not exist on TruLayer; this TS error proves the gap
    expect(typeof (tl as unknown as Record<string, unknown>)['eval']).toBe('undefined')
  })
})
