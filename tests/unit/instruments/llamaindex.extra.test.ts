import { describe, it, expect, vi } from 'vitest'
import {
  instrumentLlamaIndexQueryEngine,
  instrumentLlamaIndexRetriever,
} from '../../../src/instruments/llamaindex.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

describe('instrumentLlamaIndexQueryEngine — extra branches', () => {
  it('falls back to llm.model when llm.metadata is absent', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      llm: { model: 'claude-3-opus' },
      query: vi.fn().mockResolvedValue({ response: 'a' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.model).toBe('claude-3-opus')
  })

  it('handles string query result directly', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue('plain-string-response'),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('plain-string-response')
  })

  it('extracts output from message.content when response field absent', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ message: { content: 'msg-content' } }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('msg-content')
  })

  it('JSON.stringifies object result when no recognised text field', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ unknown: 'shape', ok: true }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('{"unknown":"shape","ok":true}')
  })

  it('returns empty output on unserialisable object', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const engine = {
      query: vi.fn().mockResolvedValue(circular),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('')
  })

  it('returns empty output when result is undefined', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue(undefined),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('')
  })

  it('returns empty query string on non-string, non-object params', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ response: 'a' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!(undefined as unknown as string)
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('')
  })

  it('records only inputTokens/outputTokens variant', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      llm: { metadata: { model: 'm' } },
      query: vi.fn().mockResolvedValue({
        response: 'a',
        usage: { inputTokens: 7, outputTokens: 3 },
      }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.prompt_tokens).toBe(7)
    expect(span?.completion_tokens).toBe(3)
    expect(span?.metadata['gen_ai.usage.input_tokens']).toBe(7)
    expect(span?.metadata['gen_ai.usage.output_tokens']).toBe(3)
  })

  it('omits retrieval.document_count when sourceNodes is absent', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ response: 'a' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.query!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.metadata['retrieval.document_count']).toBeUndefined()
  })

  it('returns a wrapped retriever when accessed via engine.retriever', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retrieve = vi.fn().mockResolvedValue([{ id: 1 }])
    const engine = {
      retriever: { retrieve },
      query: vi.fn().mockResolvedValue({ response: 'x' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)
    await instrumented.retriever!.retrieve!('inner')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.name).toBe('llamaindex.retrieve')
    expect(span?.input).toBe('inner')
    expect(span?.metadata['retrieval.document_count']).toBe(1)
  })

  it('passes through engine properties unrelated to query/retriever', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      meta: { custom: true },
      query: vi.fn(),
    } as { meta: { custom: boolean }; query: ReturnType<typeof vi.fn> }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace) as typeof engine
    expect(instrumented.meta).toEqual({ custom: true })
  })

  it('engine.retriever passthrough when retriever is falsy', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = { query: vi.fn() }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace) as {
      retriever?: unknown
    }
    expect(instrumented.retriever).toBeUndefined()
  })
})

describe('instrumentLlamaIndexRetriever — extra branches', () => {
  it('returns 0 document_count on unknown response shape', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = {
      retrieve: vi.fn().mockResolvedValue({ other: true } as unknown as unknown[]),
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace)
    await instrumented.retrieve!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.metadata['retrieval.document_count']).toBe(0)
  })

  it('returns 0 document_count when result is undefined', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = {
      retrieve: vi.fn().mockResolvedValue(undefined),
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace)
    await instrumented.retrieve!('q')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.metadata['retrieval.document_count']).toBe(0)
  })

  it('passes through retriever properties unrelated to retrieve', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = { label: 'rt', retrieve: vi.fn() } as {
      label: string
      retrieve: ReturnType<typeof vi.fn>
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace) as typeof retriever
    expect(instrumented.label).toBe('rt')
  })
})
