import { describe, it, expect, vi } from 'vitest'
import { instrumentAnthropic } from '../../../src/instruments/anthropic.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

function makeAnthropicClient(text = 'hello from claude') {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 6, output_tokens: 3 },
      }),
    },
  }
}

describe('instrumentAnthropic', () => {
  it('records a span with input/output/tokens', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = makeAnthropicClient()
    const instrumented = instrumentAnthropic(client, trace)

    await instrumented.messages.create({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hello' }],
    })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('anthropic.messages')
    expect(span?.span_type).toBe('llm')
    expect(span?.input).toBe('hello')
    expect(span?.output).toBe('hello from claude')
    expect(span?.model).toBe('claude-haiku-4-5-20251001')
    expect(span?.prompt_tokens).toBe(6)
    expect(span?.completion_tokens).toBe(3)
  })

  it('does not mutate the original client', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const original = makeAnthropicClient()
    const originalCreate = original.messages.create
    instrumentAnthropic(original, trace)
    expect(original.messages.create).toBe(originalCreate)
  })

  it('handles missing text block gracefully', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] }),
      },
    }
    const instrumented = instrumentAnthropic(client, trace)
    await instrumented.messages.create({ model: 'claude-3', messages: [] })
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.output).toBe('')
  })

  it('passes through non-messages properties unchanged', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = { ...makeAnthropicClient(), models: { list: vi.fn() } }
    const instrumented = instrumentAnthropic(client, trace)
    expect((instrumented as typeof client).models).toBe(client.models)
  })

  it('passes through non-create messages properties', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = {
      messages: { create: vi.fn(), stream: 'stream-val' },
    } as unknown as ReturnType<typeof makeAnthropicClient>
    const instrumented = instrumentAnthropic(client, trace)
    type WithStream = { stream: string }
    expect((instrumented.messages as typeof client.messages & WithStream).stream).toBe('stream-val')
  })

  it('handles missing messages array gracefully', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const client = makeAnthropicClient()
    const instrumented = instrumentAnthropic(client, trace)
    await instrumented.messages.create({ model: 'claude-3', messages: [] })
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.input).toBe('')
  })

  describe('streaming', () => {
    /** Helper: create a mock async iterable of Anthropic MessageStreamEvent objects. */
    function makeAnthropicStream(
      textDeltas: string[],
      opts?: { inputTokens?: number; outputTokens?: number },
    ): AsyncIterable<unknown> {
      // Build events: message_start -> content_block_start -> content_block_delta* -> message_delta -> message_stop
      const events: unknown[] = []
      if (opts?.inputTokens !== undefined) {
        events.push({
          type: 'message_start',
          message: { usage: { input_tokens: opts.inputTokens, output_tokens: 0 } },
        })
      }
      events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      for (const text of textDeltas) {
        events.push({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
      }
      events.push({ type: 'content_block_stop', index: 0 })
      if (opts?.outputTokens !== undefined) {
        events.push({ type: 'message_delta', usage: { output_tokens: opts.outputTokens } })
      }
      events.push({ type: 'message_stop' })

      let index = 0
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (index < events.length) {
                const value = events[index]
                index++
                return { done: false, value }
              }
              return { done: true, value: undefined }
            },
          }
        },
      }
    }

    function makeStreamingAnthropicClient(
      textDeltas: string[],
      opts?: { inputTokens?: number; outputTokens?: number },
    ) {
      return {
        messages: {
          create: vi.fn().mockResolvedValue(makeAnthropicStream(textDeltas, opts)),
        },
      }
    }

    it('accumulates streamed content_block_delta events and closes span', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const client = makeStreamingAnthropicClient(['Hello', ', ', 'world', '!'], {
        inputTokens: 8,
        outputTokens: 4,
      })
      const instrumented = instrumentAnthropic(client, trace)

      const stream = (await instrumented.messages.create({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'say hi' }],
        stream: true,
      })) as AsyncIterable<unknown>

      // Span not yet closed
      expect(trace.data.spans).toHaveLength(0)

      const collected: unknown[] = []
      for await (const event of stream) {
        collected.push(event)
      }

      // Should have yielded all events
      expect(collected.length).toBeGreaterThanOrEqual(4) // at least the 4 deltas

      // Wait for microtasks
      await new Promise((r) => setTimeout(r, 10))

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.name).toBe('anthropic.messages')
      expect(span?.span_type).toBe('llm')
      expect(span?.input).toBe('say hi')
      expect(span?.output).toBe('Hello, world!')
      expect(span?.model).toBe('claude-haiku-4-5-20251001')
      expect(span?.prompt_tokens).toBe(8)
      expect(span?.completion_tokens).toBe(4)
      expect(span?.ended_at).not.toBeNull()
    })

    it('closes span with error status when stream throws', async () => {
      const streamError = new Error('anthropic stream failed')
      const failingStream: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          let called = false
          return {
            async next() {
              if (!called) {
                called = true
                return {
                  done: false,
                  value: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
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
        messages: {
          create: vi.fn().mockResolvedValue(failingStream),
        },
      }
      const instrumented = instrumentAnthropic(client, trace)

      const stream = (await instrumented.messages.create({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      })) as AsyncIterable<unknown>

      await expect(async () => {
         
        for await (const _ of stream) {
          /* consume */
        }
      }).rejects.toThrow('anthropic stream failed')

      await new Promise((r) => setTimeout(r, 50))

      trace.finish()
      const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
      const span = payload?.spans[0]
      expect(span?.error).toBe(true)
      expect(span?.error_message).toBe('anthropic stream failed')
    })

    it('opens span before iteration begins', async () => {
      const batch = mockBatch()
      const trace = new TraceContext(batch, 'proj-1')
      const client = makeStreamingAnthropicClient(['hi'])
      const instrumented = instrumentAnthropic(client, trace)

      const stream = (await instrumented.messages.create({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'test' }],
        stream: true,
      })) as AsyncIterable<unknown>

      // Span still open
      expect(trace.data.spans).toHaveLength(0)

      for await (const _ of stream) {
        /* drain */
      }

      await new Promise((r) => setTimeout(r, 10))
      expect(trace.data.spans).toHaveLength(1)
      expect(trace.data.spans[0]?.output).toBe('hi')
    })
  })
})
