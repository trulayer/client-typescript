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
})
