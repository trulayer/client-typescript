import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TraceContext, SpanContext, _setSpanStorage, _resetSpanStorage, _ensureSpanStorage } from '../../src/trace.js'
import type { BatchSender } from '../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

/** Helper: create a SpanContext tied to a throwaway TraceContext */
function makeSpan(name: string, spanType?: 'llm' | 'tool' | 'retrieval' | 'chain' | 'default') {
  const batch = mockBatch()
  const trace = new TraceContext(batch, 'proj-test')
  return new SpanContext(trace, name, spanType)
}

describe('SpanContext', () => {
  it('initialises with correct defaults', () => {
    const span = makeSpan('llm-call', 'llm')
    expect(span.data.name).toBe('llm-call')
    expect(span.data.span_type).toBe('llm')
    expect(span.data.error).toBe(false)
    expect(span.data.parent_span_id).toBeUndefined()
  })

  it('setters return this for chaining', () => {
    const span = makeSpan('span')
    const result = span.setInput('hi').setOutput('hello').setModel('gpt-4o').setTokens(10, 5)
    expect(result).toBe(span)
    expect(span.data.input).toBe('hi')
    expect(span.data.output).toBe('hello')
    expect(span.data.model).toBe('gpt-4o')
    expect(span.data.prompt_tokens).toBe(10)
    expect(span.data.completion_tokens).toBe(5)
  })

  it('setMetadata merges properties', () => {
    const span = makeSpan('span')
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

describe('Nested spans (parent_span_id)', () => {
  afterEach(() => {
    _resetSpanStorage()
  })

  it('top-level span has no parent_span_id', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    await ctx.span('top', 'default', async () => {})
    ctx.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.parent_span_id).toBeUndefined()
  })

  it('nested span via span.span() sets parent_span_id', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    let parentId: string | undefined
    let childParentId: string | undefined

    await ctx.span('parent', 'default', async (parent) => {
      parentId = parent.data.id
      await parent.span('child', 'llm', async (child) => {
        childParentId = child.data.parent_span_id
      })
    })
    ctx.finish()

    expect(childParentId).toBe(parentId)
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    // Both spans recorded: child first (finishes first), then parent
    expect(payload?.spans).toHaveLength(2)
    const childSpan = payload?.spans.find((s) => s.name === 'child')
    expect(childSpan?.parent_span_id).toBe(parentId)
  })

  it('deeply nested spans form a chain of parent_span_ids', async () => {
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')

    await ctx.span('level-1', 'default', async (l1) => {
      await l1.span('level-2', 'llm', async (l2) => {
        await l2.span('level-3', 'tool', async () => {})
      })
    })
    ctx.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans).toHaveLength(3)

    const l1 = payload?.spans.find((s) => s.name === 'level-1')
    const l2 = payload?.spans.find((s) => s.name === 'level-2')
    const l3 = payload?.spans.find((s) => s.name === 'level-3')

    expect(l1?.parent_span_id).toBeUndefined()
    expect(l2?.parent_span_id).toBe(l1?.id)
    expect(l3?.parent_span_id).toBe(l2?.id)
  })

  it('AsyncLocalStorage auto-propagates parent_span_id across trace.span()', async () => {
    // This test verifies that when AsyncLocalStorage IS available (Node.js),
    // calling trace.span() inside another trace.span() auto-sets parent_span_id
    // without using span.span() — via AsyncLocalStorage context propagation.
    // Ensure AsyncLocalStorage is initialized before the test runs.
    _resetSpanStorage()
    await _ensureSpanStorage()

    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')
    let outerId: string | undefined

    await ctx.span('outer', 'default', async (outer) => {
      outerId = outer.data.id
      // Call trace.span() directly (not outer.span()) — should still auto-nest
      await ctx.span('inner', 'llm', async (inner) => {
        expect(inner.data.parent_span_id).toBe(outerId)
      })
    })
    ctx.finish()
  })

  it('Edge fallback: no parent_span_id when AsyncLocalStorage is absent', async () => {
    // Simulate an Edge environment by disabling the span storage
    _setSpanStorage(null)

    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')

    await ctx.span('outer', 'default', async () => {
      // Without AsyncLocalStorage, trace.span() won't auto-detect parent
      await ctx.span('inner', 'llm', async () => {})
    })
    ctx.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const inner = payload?.spans.find((s) => s.name === 'inner')
    expect(inner?.parent_span_id).toBeUndefined()
  })

  it('Edge fallback: span.span() still sets parent_span_id without AsyncLocalStorage', async () => {
    // Even without AsyncLocalStorage, calling span.span() explicitly passes parent ID
    _setSpanStorage(null)

    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')

    await ctx.span('outer', 'default', async (outer) => {
      await outer.span('inner', 'llm', async (inner) => {
        expect(inner.data.parent_span_id).toBe(outer.data.id)
      })
    })
    ctx.finish()
  })

  it('no throw when AsyncLocalStorage is absent', async () => {
    _setSpanStorage(null)

    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1')

    // Should complete without error
    await expect(
      ctx.span('safe', 'default', async () => 'ok'),
    ).resolves.toBe('ok')
  })
})
