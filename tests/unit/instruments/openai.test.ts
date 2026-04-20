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
})
