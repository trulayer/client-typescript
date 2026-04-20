import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TraceContext, SpanContext } from '../../src/trace.js'
import type { BatchSender } from '../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

describe('SpanContext', () => {
  it('initialises with correct defaults', () => {
    const span = new SpanContext('trace-1', 'llm-call', 'llm')
    expect(span.data.name).toBe('llm-call')
    expect(span.data.span_type).toBe('llm')
    expect(span.data.trace_id).toBe('trace-1')
    expect(span.data.error).toBe(false)
  })

  it('setters return this for chaining', () => {
    const span = new SpanContext('t', 'span')
    const result = span.setInput('hi').setOutput('hello').setModel('gpt-4o').setTokens(10, 5)
    expect(result).toBe(span)
    expect(span.data.input).toBe('hi')
    expect(span.data.output).toBe('hello')
    expect(span.data.model).toBe('gpt-4o')
    expect(span.data.prompt_tokens).toBe(10)
    expect(span.data.completion_tokens).toBe(5)
  })

  it('setMetadata merges properties', () => {
    const span = new SpanContext('t', 'span')
    span.setMetadata({ key1: 'val1' }).setMetadata({ key2: 'val2' })
    expect(span.data.metadata).toEqual({ key1: 'val1', key2: 'val2' })
  })
})

describe('TraceContext', () => {
  it('initialises with project ID', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1', 'my-trace')
    expect(ctx.data.project_id).toBe('proj-1')
    expect(ctx.data.name).toBe('my-trace')
    expect(ctx.data.error).toBe(false)
  })

  it('finish enqueues the trace', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    ctx.setInput('hi').setOutput('hello')
    ctx.finish()
    expect(batch.enqueue).toHaveBeenCalledOnce()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.input).toBe('hi')
    expect(payload?.output).toBe('hello')
    expect(payload?.ended_at).not.toBeNull()
  })

  it('finish marks error when passed an exception', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    ctx.finish(new Error('boom'))
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.error).toBe(true)
  })

  it('span captures timing and output', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    await ctx.span('llm-call', 'llm', async (span) => {
      span.setInput('prompt').setOutput('response')
    })
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans).toHaveLength(1)
    const span = payload?.spans[0]
    expect(span?.name).toBe('llm-call')
    expect(span?.input).toBe('prompt')
    expect(span?.output).toBe('response')
    expect(span?.latency_ms).toBeGreaterThanOrEqual(0)
    expect(span?.ended_at).not.toBeNull()
  })

  it('span marks error on throw and re-throws', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    await expect(
      ctx.span('bad', 'default', async () => {
        throw new Error('span error')
      }),
    ).rejects.toThrow('span error')

    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.error).toBe(true)
    expect(payload?.spans[0]?.error_message).toContain('span error')
  })

  it('multiple spans accumulate in order', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    await ctx.span('span-1', 'default', async () => {})
    await ctx.span('span-2', 'llm', async () => {})
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans.map((s) => s.name)).toEqual(['span-1', 'span-2'])
  })

  it('tags and metadata are passed through', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1', 'test', undefined, ['tag1'], { env: 'ci' })
    ctx.addTag('tag2')
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.tags).toEqual(['tag1', 'tag2'])
    expect(payload?.metadata).toMatchObject({ env: 'ci' })
  })

  it('external_id is forwarded to the payload', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1', 'test', undefined, undefined, undefined, 'ext-42')
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.external_id).toBe('ext-42')
  })

  it('setModel and setCost populate trace-level fields', () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    ctx.setModel('gpt-4o-mini').setCost(0.0123)
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.model).toBe('gpt-4o-mini')
    expect(payload?.cost).toBeCloseTo(0.0123)
  })

  it('finish auto-derives latency_ms from start to end', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    await new Promise((r) => setTimeout(r, 5))
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.latency_ms).not.toBeNull()
    expect(payload!.latency_ms!).toBeGreaterThanOrEqual(0)
  })
})
