import { describe, it, expect, vi } from 'vitest'
import {
  instrumentMastraAgent,
  instrumentMastraWorkflow,
} from '../../../src/instruments/mastra.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    name: 'support',
    model: { modelId: 'gpt-4o' },
    generate: vi.fn().mockResolvedValue({
      text: 'hi there',
      usage: { promptTokens: 12, completionTokens: 5 },
    }),
    stream: vi.fn().mockReturnValue({
      text: Promise.resolve('streamed'),
      usage: Promise.resolve({ inputTokens: 3, outputTokens: 9 }),
    }),
    ...overrides,
  }
}

describe('instrumentMastraAgent', () => {
  it('records a span with input, output, model and tokens on generate()', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = makeAgent()
    const instrumented = instrumentMastraAgent(agent, trace)

    await instrumented.generate({ messages: [{ role: 'user', content: 'hello' }] })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('mastra.support.generate')
    expect(span?.span_type).toBe('llm')
    expect(span?.input).toBe('hello')
    expect(span?.output).toBe('hi there')
    expect(span?.model).toBe('gpt-4o')
    expect(span?.prompt_tokens).toBe(12)
    expect(span?.completion_tokens).toBe(5)
    expect(span?.metadata['gen_ai.system']).toBe('mastra')
    expect(span?.metadata['gen_ai.request.model']).toBe('gpt-4o')
    expect(span?.metadata['gen_ai.usage.input_tokens']).toBe(12)
    expect(span?.metadata['gen_ai.usage.output_tokens']).toBe(5)
  })

  it('records a span on stream() with text+usage from promises', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = makeAgent()
    const instrumented = instrumentMastraAgent(agent, trace)

    await instrumented.stream({ prompt: 'go' })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('mastra.support.stream')
    expect(span?.input).toBe('go')
    expect(span?.output).toBe('streamed')
    expect(span?.prompt_tokens).toBe(3)
    expect(span?.completion_tokens).toBe(9)
    expect(span?.metadata['gen_ai.system']).toBe('mastra')
  })

  it('omits tokens gracefully when not provided', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = makeAgent({
      generate: vi.fn().mockResolvedValue({ text: 'no-usage-response' }),
    })
    const instrumented = instrumentMastraAgent(agent, trace)

    await instrumented.generate({ prompt: 'p' })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.prompt_tokens).toBeNull()
    expect(span?.completion_tokens).toBeNull()
    expect(span?.metadata['gen_ai.usage.input_tokens']).toBeUndefined()
  })

  it('does not mutate the original agent', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = makeAgent()
    const originalGenerate = agent.generate
    instrumentMastraAgent(agent, trace)
    expect(agent.generate).toBe(originalGenerate)
  })

  it('surfaces user errors from generate() unchanged', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const boom = new Error('boom')
    const agent = makeAgent({ generate: vi.fn().mockRejectedValue(boom) })
    const instrumented = instrumentMastraAgent(agent, trace)

    await expect(instrumented.generate({ prompt: 'x' })).rejects.toThrow('boom')
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.error).toBe(true)
    expect(span?.error_message).toBe('boom')
  })
})

describe('instrumentMastraWorkflow', () => {
  it('records a workflow span on execute()', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = {
      name: 'rag',
      execute: vi.fn().mockResolvedValue({ ok: true }),
      steps: {},
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)

    await instrumented.execute!({ query: 'hello' })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('mastra.workflow.rag')
    expect(span?.span_type).toBe('chain')
    expect(span?.metadata['gen_ai.system']).toBe('mastra')
    expect(span?.output).toBe('{"ok":true}')
  })

  it('wraps individual steps with child spans', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const stepExecute = vi.fn().mockResolvedValue('step-out')
    const workflow = {
      name: 'wf',
      execute: vi.fn().mockImplementation(async () => {
        // simulate the workflow engine invoking step.execute during workflow execution
        // so the step span nests under the workflow span via AsyncLocalStorage
        await (instrumented.steps as Record<string, { execute: (i: unknown) => unknown }>)[
          'fetch'
        ]!.execute('step-in')
        return 'done'
      }),
      steps: {
        fetch: { id: 'fetch', execute: stepExecute },
      },
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)

    await instrumented.execute!({})
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const spans = payload?.spans ?? []
    // workflow + step
    expect(spans.length).toBe(2)
    const stepSpan = spans.find((s) => s.name === 'mastra.step.fetch')
    expect(stepSpan).toBeDefined()
    expect(stepSpan?.input).toBe('step-in')
    expect(stepSpan?.output).toBe('step-out')
  })
})
