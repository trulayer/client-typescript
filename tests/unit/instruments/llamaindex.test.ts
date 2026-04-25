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

describe('instrumentLlamaIndexQueryEngine', () => {
  it('records a synthesis span with input, output, model and sourceNodes count', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      llm: { metadata: { model: 'gpt-4o' } },
      query: vi.fn().mockResolvedValue({
        response: 'the answer is 42',
        sourceNodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        usage: { promptTokens: 10, completionTokens: 4 },
      }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)

    await instrumented.query!('what?')
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('llamaindex.query')
    expect(span?.span_type).toBe('llm')
    expect(span?.input).toBe('what?')
    expect(span?.output).toBe('the answer is 42')
    expect(span?.model).toBe('gpt-4o')
    expect(span?.prompt_tokens).toBe(10)
    expect(span?.completion_tokens).toBe(4)
    expect(span?.metadata['gen_ai.system']).toBe('llamaindex')
    expect(span?.metadata['gen_ai.request.model']).toBe('gpt-4o')
    expect(span?.metadata['retrieval.document_count']).toBe(3)
  })

  it('handles string query params', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ response: 'ok' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)

    await instrumented.query!({ query: 'hi' })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.input).toBe('hi')
  })

  it('omits model when not exposed by the engine', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = {
      query: vi.fn().mockResolvedValue({ response: 'out' }),
    }
    const instrumented = instrumentLlamaIndexQueryEngine(engine, trace)

    await instrumented.query!('q')
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.model).toBeNull()
    expect(span?.metadata['gen_ai.request.model']).toBeUndefined()
  })

  it('does not mutate the original engine', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const engine = { query: vi.fn() }
    const originalQuery = engine.query
    instrumentLlamaIndexQueryEngine(engine, trace)
    expect(engine.query).toBe(originalQuery)
  })
})

describe('instrumentLlamaIndexRetriever', () => {
  it('records a retrieval span with document_count metadata (array response)', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = {
      retrieve: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace)

    await instrumented.retrieve!('find docs')
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('llamaindex.retrieve')
    expect(span?.span_type).toBe('retrieval')
    expect(span?.input).toBe('find docs')
    expect(span?.metadata['gen_ai.system']).toBe('llamaindex')
    expect(span?.metadata['retrieval.document_count']).toBe(2)
  })

  it('handles nested `nodes` response shape', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = {
      retrieve: vi.fn().mockResolvedValue({ nodes: [{ id: 'x' }] }),
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace)

    await instrumented.retrieve!({ query: 'q' })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.metadata['retrieval.document_count']).toBe(1)
  })

  it('surfaces errors from retrieve() unchanged', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const retriever = {
      retrieve: vi.fn().mockRejectedValue(new Error('retrieval boom')),
    }
    const instrumented = instrumentLlamaIndexRetriever(retriever, trace)

    await expect(instrumented.retrieve!('q')).rejects.toThrow('retrieval boom')
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.error).toBe('retrieval boom')
  })
})
