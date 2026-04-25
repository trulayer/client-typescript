import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TruLayerCallbackHandler } from '../../../src/instruments/langchain.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

/** Wait for microtasks / async span resolution */
async function tick(ms = 10): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

describe('TruLayerCallbackHandler', () => {
  let batch: BatchSender
  let trace: TraceContext
  let handler: TruLayerCallbackHandler

  beforeEach(() => {
    batch = mockBatch()
    trace = new TraceContext(batch, 'proj-1', 'langchain-trace')
    handler = new TruLayerCallbackHandler(trace)
  })

  describe('LLM callbacks', () => {
    it('handleLLMStart opens an llm span with prompt as input', async () => {
      const runId = 'llm-run-1'
      handler.handleLLMStart({ name: 'gpt-4o' }, ['What is 2+2?'], runId)
      await tick()

      // Span is open — close it
      handler.handleLLMEnd(
        { generations: [[{ text: '4' }]] },
        runId,
      )
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'gpt-4o')
      expect(span).toBeDefined()
      expect(span?.span_type).toBe('llm')
      expect(span?.input).toBe('What is 2+2?')
    })

    it('handleLLMEnd closes the span with output', async () => {
      const runId = 'llm-run-2'
      handler.handleLLMStart({ name: 'claude' }, ['Hello'], runId)
      await tick()

      handler.handleLLMEnd(
        { generations: [[{ text: 'Hi there!' }]] },
        runId,
      )
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'claude')
      expect(span?.output).toBe('Hi there!')
      expect(span?.error).toBeNull()
    })

    it('handleLLMError closes the span with error status', async () => {
      const runId = 'llm-run-3'
      handler.handleLLMStart({ name: 'llm' }, ['test'], runId)
      await tick()

      handler.handleLLMError(new Error('rate limited'), runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'llm')
      expect(span?.error).toBe('rate limited')
    })

    it('joins multiple prompts with newlines', async () => {
      const runId = 'llm-run-4'
      handler.handleLLMStart({ name: 'llm' }, ['prompt1', 'prompt2'], runId)
      await tick()

      handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'llm')
      expect(span?.input).toBe('prompt1\nprompt2')
    })

    it('handles empty generations gracefully', async () => {
      const runId = 'llm-run-5'
      handler.handleLLMStart({ name: 'llm' }, ['test'], runId)
      await tick()

      handler.handleLLMEnd({ generations: [] }, runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'llm')
      expect(span?.output).toBe('')
    })

    it('falls back to "llm" name when llm.name is absent', async () => {
      const runId = 'llm-run-6'
      handler.handleLLMStart({}, ['test'], runId)
      await tick()

      handler.handleLLMEnd({ generations: [[{ text: 'ok' }]] }, runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'llm')
      expect(span).toBeDefined()
    })
  })

  describe('Tool callbacks', () => {
    it('handleToolStart opens a tool span with input', async () => {
      const runId = 'tool-run-1'
      handler.handleToolStart({ name: 'calculator' }, '{"a": 1, "b": 2}', runId)
      await tick()

      handler.handleToolEnd('3', runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'calculator')
      expect(span?.span_type).toBe('tool')
      expect(span?.input).toBe('{"a": 1, "b": 2}')
      expect(span?.output).toBe('3')
    })

    it('handleToolError closes the span with error', async () => {
      const runId = 'tool-run-2'
      handler.handleToolStart({ name: 'search' }, 'query', runId)
      await tick()

      handler.handleToolError(new Error('timeout'), runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'search')
      expect(span?.error).toBe('timeout')
    })

    it('falls back to "tool" name when tool.name is absent', async () => {
      const runId = 'tool-run-3'
      handler.handleToolStart({}, 'input', runId)
      await tick()

      handler.handleToolEnd('output', runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'tool')
      expect(span).toBeDefined()
    })
  })

  describe('Chain callbacks', () => {
    it('handleChainStart opens a default span', async () => {
      const runId = 'chain-run-1'
      handler.handleChainStart({ name: 'retrieval-chain' }, { query: 'test' }, runId)
      await tick()

      handler.handleChainEnd({ answer: 'result' }, runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'retrieval-chain')
      expect(span?.span_type).toBe('other')
      expect(span?.input).toBe(JSON.stringify({ query: 'test' }))
      expect(span?.output).toBe(JSON.stringify({ answer: 'result' }))
    })

    it('handleChainError closes the span with error', async () => {
      const runId = 'chain-run-2'
      handler.handleChainStart({ name: 'chain' }, {}, runId)
      await tick()

      handler.handleChainError(new Error('chain failed'), runId)
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans.find((s) => s.name === 'chain')
      expect(span?.error).toBe('chain failed')
    })
  })

  describe('Integration with trace context', () => {
    it('handler works correctly within an active tl.trace() context', async () => {
      // Simulate the full flow: TruLayer.trace() -> handler callbacks
      const batch2 = mockBatch()
      const ctx = new TraceContext(batch2, 'proj-2', 'qa-pipeline')
      const h = new TruLayerCallbackHandler(ctx)

      // Chain starts
      h.handleChainStart({ name: 'qa' }, { question: 'Why?' }, 'chain-1')
      await tick()

      // LLM called within chain
      h.handleLLMStart({ name: 'gpt-4o' }, ['Why?'], 'llm-1')
      await tick()

      h.handleLLMEnd({ generations: [[{ text: 'Because.' }]] }, 'llm-1')
      await tick()

      // Chain ends
      h.handleChainEnd({ answer: 'Because.' }, 'chain-1')
      await tick()

      ctx.finish()

      const payload = vi.mocked(batch2.enqueue).mock.calls[0]?.[0]
      expect(payload?.spans).toHaveLength(2)

      const chainSpan = payload?.spans.find((s) => s.name === 'qa')
      const llmSpan = payload?.spans.find((s) => s.name === 'gpt-4o')
      expect(chainSpan).toBeDefined()
      expect(llmSpan).toBeDefined()
      expect(chainSpan?.span_type).toBe('other')
      expect(llmSpan?.span_type).toBe('llm')
      expect(llmSpan?.input).toBe('Why?')
      expect(llmSpan?.output).toBe('Because.')
    })

    it('multiple concurrent spans do not interfere', async () => {
      handler.handleLLMStart({ name: 'llm-a' }, ['prompt-a'], 'run-a')
      handler.handleLLMStart({ name: 'llm-b' }, ['prompt-b'], 'run-b')
      await tick()

      handler.handleLLMEnd({ generations: [[{ text: 'output-b' }]] }, 'run-b')
      handler.handleLLMEnd({ generations: [[{ text: 'output-a' }]] }, 'run-a')
      await tick()

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      expect(payload?.spans).toHaveLength(2)

      const spanA = payload?.spans.find((s) => s.name === 'llm-a')
      const spanB = payload?.spans.find((s) => s.name === 'llm-b')
      expect(spanA?.output).toBe('output-a')
      expect(spanB?.output).toBe('output-b')
    })

    it('ignores closeSpan for unknown runId', () => {
      // Should not throw
      handler.handleLLMEnd({ generations: [[{ text: 'x' }]] }, 'unknown-id')
      handler.handleLLMError(new Error('x'), 'unknown-id')
      handler.handleToolEnd('x', 'unknown-id')
      handler.handleToolError(new Error('x'), 'unknown-id')
      handler.handleChainEnd({}, 'unknown-id')
      handler.handleChainError(new Error('x'), 'unknown-id')
    })
  })
})
