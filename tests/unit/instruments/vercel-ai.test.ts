import { describe, it, expect, vi } from 'vitest'
import { instrumentVercelAI } from '../../../src/instruments/vercel-ai.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

function makeGenerateText(text = 'hello', promptTokens = 5, completionTokens = 3) {
  return vi.fn().mockResolvedValue({
    text,
    usage: { promptTokens, completionTokens },
  })
}

function makeStreamText(text = 'streamed hello', promptTokens = 6, completionTokens = 4) {
  return vi.fn().mockReturnValue({
    text: Promise.resolve(text),
    usage: Promise.resolve({ promptTokens, completionTokens }),
  })
}

function makeGenerateObject(obj = { answer: 42 }, promptTokens = 7, completionTokens = 2) {
  return vi.fn().mockResolvedValue({
    object: obj,
    usage: { promptTokens, completionTokens },
  })
}

describe('instrumentVercelAI', () => {
  describe('generateText', () => {
    it('records a span with input/output/tokens', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const generateText = makeGenerateText()
      const { generateText: wrapped } = instrumentVercelAI({ generateText }, trace)

      await wrapped({
        model: { modelId: 'gpt-4o' },
        prompt: 'what is 2+2?',
      })
      trace.finish()

      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.name).toBe('vercel-ai.generateText')
      expect(span?.span_type).toBe('llm')
      expect(span?.input).toBe('what is 2+2?')
      expect(span?.output).toBe('hello')
      expect(span?.model).toBe('gpt-4o')
      expect(span?.prompt_tokens).toBe(5)
      expect(span?.completion_tokens).toBe(3)
    })

    it('extracts input from messages array', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const generateText = makeGenerateText()
      const { generateText: wrapped } = instrumentVercelAI({ generateText }, trace)

      await wrapped({
        model: { modelId: 'gpt-4o' },
        messages: [
          { role: 'user', content: 'hello from messages' },
        ],
      })
      trace.finish()

      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      expect(payload?.spans[0]?.input).toBe('hello from messages')
    })
  })

  describe('streamText', () => {
    it('records a span after stream resolves', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const streamText = makeStreamText()
      const { streamText: wrapped } = instrumentVercelAI({ streamText }, trace)

      wrapped({ model: { modelId: 'claude-3' }, prompt: 'stream this' })
      // Give the background async work time to settle
      await new Promise((r) => setTimeout(r, 20))
      trace.finish()

      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.name).toBe('vercel-ai.streamText')
      expect(span?.input).toBe('stream this')
      expect(span?.output).toBe('streamed hello')
      expect(span?.model).toBe('claude-3')
    })
  })

  describe('generateObject', () => {
    it('serialises the object to JSON as output', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const generateObject = makeGenerateObject()
      const { generateObject: wrapped } = instrumentVercelAI({ generateObject }, trace)

      await wrapped({ model: { modelId: 'gpt-4o' }, prompt: 'give me a number' })
      trace.finish()

      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.name).toBe('vercel-ai.generateObject')
      expect(span?.output).toBe('{"answer":42}')
      expect(span?.prompt_tokens).toBe(7)
    })
  })

  it('handles partial fns — only wraps what is provided', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const generateText = makeGenerateText()
    const { generateText: wrapped, streamText, generateObject } = instrumentVercelAI(
      { generateText },
      trace,
    )

    expect(wrapped).toBeDefined()
    expect(streamText).toBeUndefined()
    expect(generateObject).toBeUndefined()
  })
})
