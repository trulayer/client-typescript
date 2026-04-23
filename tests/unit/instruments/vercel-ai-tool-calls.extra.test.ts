import { describe, it, expect, vi } from 'vitest'
import { instrumentVercelAITools } from '../../../src/instruments/vercel-ai-tool-calls.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

describe('instrumentVercelAITools — extra branches', () => {
  it('serialises a string input/output as-is (no JSON wrapping)', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools(
      { s: { execute: vi.fn().mockResolvedValue('plain-out') } },
      trace,
    )
    await wrapped.s.execute!('plain-in')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('plain-in')
    expect(span?.output).toBe('plain-out')
  })

  it('serialises undefined input/output as empty string', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools(
      { s: { execute: vi.fn().mockResolvedValue(undefined) } },
      trace,
    )
    await wrapped.s.execute!(undefined)
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('')
    expect(span?.output).toBe('')
  })

  it('falls back to String() when the value cannot be JSON-stringified', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const wrapped = instrumentVercelAITools(
      { s: { execute: vi.fn().mockResolvedValue(circular) } },
      trace,
    )
    await wrapped.s.execute!(circular)
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe(String(circular))
    expect(span?.output).toBe(String(circular))
  })

  it('preserves other tool properties on the wrapped tool', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const tools = {
      t: {
        description: 'keeps',
        parameters: { type: 'object' },
        execute: vi.fn().mockResolvedValue(1),
      },
    }
    const wrapped = instrumentVercelAITools(tools, trace)
    expect(wrapped.t.description).toBe('keeps')
    expect(wrapped.t.parameters).toEqual({ type: 'object' })
  })

  it('runs without toolCallId options argument at all', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools(
      { t: { execute: vi.fn().mockResolvedValue('ok') } },
      trace,
    )
    await wrapped.t.execute!({ k: 1 })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.metadata['gen_ai.tool.call.id']).toBeUndefined()
    expect(span?.metadata['gen_ai.tool.name']).toBe('t')
  })

  it('returns an empty wrapped record when no tools are provided', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools({}, trace)
    expect(wrapped).toEqual({})
  })
})
