import { describe, it, expect, vi } from 'vitest'
import { TraceContext } from '../../src/trace.js'
import type { BatchSender } from '../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

/**
 * The latency waterfall positions bars by absolute `start_time`. When a
 * batch is flushed after a trace completes, every span needs an accurate
 * wall-clock pair: started_at captured *before* the operation begins and
 * ended_at captured *after* it completes.
 */
describe('span timing', () => {
  it('started_at is captured before the callback runs', async () => {
    const trace = new TraceContext(mockBatch(), 'proj')
    let observedStart: string | null = null

    await trace.span('llm', 'llm', async (span) => {
      observedStart = span.data.started_at
      // sleep so the gap between started_at and now becomes measurable
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(observedStart).not.toBeNull()
    // started_at, as visible inside the callback, must precede the moment
    // we observe it (i.e. it was stamped before the callback fired).
    const startedAtMs = Date.parse(observedStart as unknown as string)
    expect(Number.isFinite(startedAtMs)).toBe(true)
    expect(Date.now() - startedAtMs).toBeGreaterThanOrEqual(0)
  })

  it('ended_at is captured after the callback completes', async () => {
    const trace = new TraceContext(mockBatch(), 'proj')

    await trace.span('llm', 'llm', async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const span = trace.data.spans[0]
    expect(span).toBeDefined()
    expect(span.ended_at).not.toBeNull()
    const start = Date.parse(span.started_at)
    const end = Date.parse(span.ended_at as string)
    expect(end).toBeGreaterThanOrEqual(start)
    expect(end - start).toBeGreaterThanOrEqual(15) // slack for slow CI
  })

  it('latency_ms is consistent with started_at / ended_at', async () => {
    const trace = new TraceContext(mockBatch(), 'proj')

    await trace.span('llm', 'llm', async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    const span = trace.data.spans[0]
    expect(span.latency_ms).not.toBeNull()
    const start = Date.parse(span.started_at)
    const end = Date.parse(span.ended_at as string)
    const wallDelta = end - start
    // latency_ms is measured separately via Date.now() so allow a small gap.
    expect(Math.abs(wallDelta - (span.latency_ms as number))).toBeLessThan(10)
  })

  it('started_at across sequential spans is strictly non-decreasing', async () => {
    const trace = new TraceContext(mockBatch(), 'proj')

    await trace.span('a', 'llm', async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await trace.span('b', 'llm', async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await trace.span('c', 'llm', async () => {
      await new Promise((r) => setTimeout(r, 5))
    })

    const starts = trace.data.spans.map((s) => Date.parse(s.started_at))
    expect(starts[0]).toBeLessThanOrEqual(starts[1])
    expect(starts[1]).toBeLessThanOrEqual(starts[2])
    // Each span's end must precede or equal the next span's start.
    expect(Date.parse(trace.data.spans[0].ended_at as string)).toBeLessThanOrEqual(starts[1])
    expect(Date.parse(trace.data.spans[1].ended_at as string)).toBeLessThanOrEqual(starts[2])
  })

  it('started_at is not later than the constructor timestamp', async () => {
    // Guards the regression: if we delete the explicit `span.data.started_at = startedAt`
    // assignment in trace.span(), the timestamp from the SpanContext constructor (a
    // tick earlier) would still be there — but if a future refactor moved span
    // construction to happen lazily *after* the callback, started_at could drift
    // forward. Verify they are essentially the same moment.
    const trace = new TraceContext(mockBatch(), 'proj')
    const before = Date.now()
    await trace.span('llm', 'llm', async () => {})
    const after = Date.now()

    const span = trace.data.spans[0]
    const startedAtMs = Date.parse(span.started_at)
    expect(startedAtMs).toBeGreaterThanOrEqual(before)
    expect(startedAtMs).toBeLessThanOrEqual(after)
  })
})
