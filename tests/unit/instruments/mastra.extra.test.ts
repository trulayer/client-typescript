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

describe('instrumentMastraAgent — extra branch coverage', () => {
  it('uses agent.model as a string when provided', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      model: 'claude-3-5-sonnet',
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'hello' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.model).toBe('claude-3-5-sonnet')
    expect(span?.metadata['gen_ai.request.model']).toBe('claude-3-5-sonnet')
  })

  it('falls back to agent.llm.modelId when model is not set', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      llm: { modelId: 'gpt-4o-mini' },
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'hi' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.model).toBe('gpt-4o-mini')
  })

  it('uses default agent name when name is missing', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      generate: vi.fn().mockResolvedValue({ text: 'x' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'p' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.name).toBe('mastra.agent.generate')
  })

  it('extracts input from messages string content', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'last-string' },
      ],
    })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('last-string')
  })

  it('extracts input from messages with array text blocks', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', text: undefined },
            { type: 'text', text: 'from-block' },
          ],
        },
      ],
    })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('from-block')
  })

  it('returns empty input when params is undefined', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!(undefined as unknown as Record<string, never>)
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('')
  })

  it('returns empty input when messages array is empty', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ text: 'out' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ messages: [] })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('')
  })

  it('extracts output from result.content when text is missing', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ content: 'from-content' }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('from-content')
  })

  it('extracts output from result.response.text', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ response: { text: 'nested' } }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('nested')
  })

  it('extracts output from result.object via JSON.stringify', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ object: { ok: 1 } }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('{"ok":1}')
  })

  it('returns empty output when result.object is unserialisable (circular)', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({ object: circular }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('')
  })

  it('returns empty output when result has no recognised fields', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue({}),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('')
  })

  it('returns empty output when result is undefined', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      generate: vi.fn().mockResolvedValue(undefined),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.generate!({ prompt: 'q' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBe('')
  })

  it('stream: handles missing text/usage gracefully', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      name: 'a',
      stream: vi.fn().mockReturnValue({}),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.stream!({ prompt: 'hi' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.output).toBeNull()
    expect(span?.prompt_tokens).toBeNull()
  })

  it('stream: uses default name when agent.name is missing', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const agent = {
      stream: vi.fn().mockReturnValue({
        text: Promise.resolve('ok'),
        usage: Promise.resolve({ promptTokens: 1, completionTokens: 2 }),
      }),
    }
    const instrumented = instrumentMastraAgent(agent, trace)
    await instrumented.stream!({ prompt: 'p' })
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.name).toBe('mastra.agent.stream')
  })

  it('passes through non-generate/non-stream properties unchanged', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const sentinel = { value: 42 }
    const agent = {
      name: 'a',
      custom: sentinel,
      generate: vi.fn(),
    }
    const instrumented = instrumentMastraAgent(agent, trace) as typeof agent & {
      custom: { value: number }
    }
    expect(instrumented.custom).toBe(sentinel)
  })
})

describe('instrumentMastraWorkflow — extra branch coverage', () => {
  it('supports workflows whose steps are an array', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const stepExec = vi.fn().mockResolvedValue('s-out')
    const workflow = {
      name: 'wf',
      execute: vi.fn().mockImplementation(async () => {
        const steps = (instrumented.steps as Array<{ execute: (i: unknown) => unknown }>)!
        await steps[0]!.execute('s-in')
        return 'done'
      }),
      steps: [{ id: 's0', execute: stepExec }],
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    await instrumented.execute!({ k: 'v' })
    trace.finish()
    const spans = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans ?? []
    const step = spans.find((s) => s.name === 'mastra.step.s0')
    expect(step?.input).toBe('s-in')
    expect(step?.output).toBe('s-out')
  })

  it('uses workflow.name fallback when omitted', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = { execute: vi.fn().mockResolvedValue('r') }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    await instrumented.execute!('str-in')
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.name).toBe('mastra.workflow.workflow')
    expect(span?.input).toBe('str-in')
    expect(span?.output).toBe('r')
  })

  it('workflow without steps returns steps as undefined passthrough', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = { name: 'wf', execute: vi.fn() }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    expect(instrumented.steps).toBeUndefined()
  })

  it('handles null execute args (uses empty object fallback)', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = {
      name: 'wf',
      execute: vi.fn().mockResolvedValue(undefined),
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    await instrumented.execute!()
    trace.finish()
    const span = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans[0]
    expect(span?.input).toBe('{}')
    // JSON.stringify of empty string is '""', used for undefined result
    expect(span?.output).toBe('""')
  })

  it('step uses fallback name when id is missing', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = {
      name: 'wf',
      execute: vi.fn().mockImplementation(async () => {
        await (
          instrumented.steps as Record<string, { execute: (i: unknown) => unknown }>
        )!['go']!.execute('i')
      }),
      steps: {
        go: { name: 'namedStep', execute: vi.fn().mockResolvedValue('o') },
      },
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    await instrumented.execute!({})
    trace.finish()
    const spans = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans ?? []
    expect(spans.find((s) => s.name === 'mastra.step.namedStep')).toBeDefined()
  })

  it('step uses "step" fallback when neither id nor name present', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = {
      name: 'wf',
      execute: vi.fn().mockImplementation(async () => {
        await (
          instrumented.steps as Record<string, { execute: (i: unknown) => unknown }>
        )!['anon']!.execute('i')
      }),
      steps: {
        anon: { execute: vi.fn().mockResolvedValue('o') },
      },
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    await instrumented.execute!({})
    trace.finish()
    const spans = vi.mocked(batch.enqueue).mock.calls[0]?.[0]?.spans ?? []
    expect(spans.find((s) => s.name === 'mastra.step.step')).toBeDefined()
  })

  it('step without an execute function is passed through', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const sentinel = { id: 'info' }
    const workflow = {
      name: 'wf',
      execute: vi.fn(),
      steps: { info: sentinel },
    }
    const instrumented = instrumentMastraWorkflow(workflow, trace)
    // proxied step preserves own properties; the sentinel's own property access path
    const step = (instrumented.steps as Record<string, { id?: string }>)!['info']!
    expect(step.id).toBe('info')
  })

  it('workflow passthrough for non-execute properties', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const workflow = {
      name: 'wf',
      description: 'hello',
      execute: vi.fn(),
    } as { name: string; description: string; execute: ReturnType<typeof vi.fn> }
    const instrumented = instrumentMastraWorkflow(workflow, trace) as typeof workflow
    expect(instrumented.description).toBe('hello')
  })
})
