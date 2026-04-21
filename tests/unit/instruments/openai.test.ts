import { describe, it, expect, vi } from 'vitest'
import { instrumentOpenAI } from '../../../src/instruments/openai.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

function makeOpenAIClient(responseContent = 'hello from gpt') {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseContent } }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
      },
    },
  }
}

describe('instrumentOpenAI', () => {
  it('records a span with input/output/tokens', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = makeOpenAIClient()
    const instrumented = instrumentOpenAI(client, trace)

    await instrumented.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'ping' }],
    })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('openai.chat')
    expect(span?.span_type).toBe('llm')
    expect(span?.input).toBe('ping')
    expect(span?.output).toBe('hello from gpt')
    expect(span?.model).toBe('gpt-4o')
    expect(span?.prompt_tokens).toBe(8)
    expect(span?.completion_tokens).toBe(4)
  })

  it('does not mutate the original client', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const original = makeOpenAIClient()
    const originalCreate = original.chat.completions.create
    instrumentOpenAI(original, trace)
    expect(original.chat.completions.create).toBe(originalCreate)
  })

  it('passes through non-chat properties unchanged', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = { ...makeOpenAIClient(), someOtherProp: 'value' }
    const instrumented = instrumentOpenAI(client, trace)
    expect((instrumented as typeof client).someOtherProp).toBe('value')
  })

  it('passes through non-completions chat properties', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = {
      chat: { completions: { create: vi.fn() }, otherChatProp: 'chat-value' },
    } as unknown as ReturnType<typeof makeOpenAIClient>
    const instrumented = instrumentOpenAI(client, trace)
    expect((instrumented.chat as typeof client.chat & { otherChatProp: string }).otherChatProp).toBe('chat-value')
  })

  it('passes through non-create completions properties', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = {
      chat: {
        completions: { create: vi.fn(), stream: 'stream-value' },
      },
    } as unknown as ReturnType<typeof makeOpenAIClient>
    const instrumented = instrumentOpenAI(client, trace)
    type WithStream = { stream: string }
    expect((instrumented.chat.completions as typeof client.chat.completions & WithStream).stream).toBe('stream-value')
  })

  it('handles missing messages array gracefully', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = makeOpenAIClient()
    const instrumented = instrumentOpenAI(client, trace)
    await instrumented.chat.completions.create({ model: 'gpt-4o', messages: [] })
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.input).toBe('')
  })

  describe('streaming', () => {
    /** Helper: create a mock async iterable of OpenAI ChatCompletionChunk objects. */
    function makeStreamChunks(
      deltas: string[],
      opts?: { usage?: { prompt_tokens: number; completion_tokens: number } },
    ): AsyncIterable<unknown> {
      let index = 0
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (index < deltas.length) {
                const content = deltas[index]!
                index++
                return {
                  done: false,
                  value: {
                    choices: [{ delta: { content }, finish_reason: null }],
                  },
                }
              }
              // Final chunk with usage if provided
              if (index === deltas.length && opts?.usage) {
                index++
                return {
                  done: false,
                  value: {
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                    usage: opts.usage,
                  },
                }
              }
              return { done: true, value: undefined }
            },
          }
        },
      }
    }

    function makeStreamingOpenAIClient(deltas: string[], usage?: { prompt_tokens: number; completion_tokens: number }) {
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(makeStreamChunks(deltas, usage ? { usage } : undefined)),
          },
        },
      }
    }

    it('accumulates streamed chunks and closes span with full output', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const client = makeStreamingOpenAIClient(['Hello', ', ', 'world', '!'], {
        prompt_tokens: 5,
        completion_tokens: 4,
      })
      const instrumented = instrumentOpenAI(client, trace)

      const stream = (await instrumented.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'say hi' }],
        stream: true,
      })) as AsyncIterable<unknown>

      // Span should be open before we iterate
      expect(trace.data.spans).toHaveLength(0) // span not yet pushed (still open)

      const collected: unknown[] = []
      for await (const chunk of stream) {
        collected.push(chunk)
      }

      // All chunks should be yielded
      expect(collected).toHaveLength(5) // 4 content deltas + 1 usage/stop

      // Wait for microtasks to settle (span closes asynchronously after stream ends)
      await new Promise((r) => setTimeout(r, 50))

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.name).toBe('openai.chat')
      expect(span?.span_type).toBe('llm')
      expect(span?.input).toBe('say hi')
      expect(span?.output).toBe('Hello, world!')
      expect(span?.model).toBe('gpt-4o')
      expect(span?.prompt_tokens).toBe(5)
      expect(span?.completion_tokens).toBe(4)
      expect(span?.ended_at).not.toBeNull()
    })

    it('closes span with error status when stream throws', async () => {
      const streamError = new Error('stream broke')
      const failingStream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          let called = false
          return {
            async next() {
              if (!called) {
                called = true
                return {
                  done: false,
                  value: { choices: [{ delta: { content: 'partial' } }] },
                }
              }
              throw streamError
            },
          }
        },
      }

      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const client = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(failingStream),
          },
        },
      }
      const instrumented = instrumentOpenAI(client, trace)

      const stream = (await instrumented.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      })) as AsyncIterable<unknown>

      await expect(async () => {
         
        for await (const _ of stream) {
          /* consume */
        }
      }).rejects.toThrow('stream broke')

      // Give microtasks time to settle (span error propagation)
      await new Promise((r) => setTimeout(r, 50))

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.error).toBe(true)
      expect(span?.error_message).toBe('stream broke')
    })

    it('opens span before iteration begins', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const client = makeStreamingOpenAIClient(['hi'])
      const instrumented = instrumentOpenAI(client, trace)

      // Getting the stream should already have the span "in flight"
      const stream = (await instrumented.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      })) as AsyncIterable<unknown>

      // The span should not be in data.spans yet (it's still open)
      expect(trace.data.spans).toHaveLength(0)

      // Consume
      for await (const _ of stream) {
        /* drain */
      }

      // Now the span should be recorded
      // Give microtasks a moment to settle
      await new Promise((r) => setTimeout(r, 10))
      expect(trace.data.spans).toHaveLength(1)
      expect(trace.data.spans[0]?.output).toBe('hi')
    })
  })
})
