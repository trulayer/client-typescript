import { describe, it, expect, vi } from 'vitest'
import { instrumentVercelAITools } from '../../../src/instruments/vercel-ai-tool-calls.js'
import { TraceContext } from '../../../src/trace.js'
import type { BatchSender } from '../../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

describe('instrumentVercelAITools', () => {
  it('records a child span per tool invocation with gen_ai.tool.* metadata', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')

    const weatherExecute = vi.fn().mockResolvedValue({ tempC: 21 })
    const tools = {
      getWeather: { description: 'returns temp', execute: weatherExecute },
    }
    const wrapped = instrumentVercelAITools(tools, trace)

    const out = await wrapped.getWeather.execute!({ city: 'LON' }, { toolCallId: 'tc_abc' })
    expect(out).toEqual({ tempC: 21 })
    trace.finish()

    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.name).toBe('vercel-ai.tool.getWeather')
    expect(span?.span_type).toBe('tool')
    expect(span?.input).toBe('{"city":"LON"}')
    expect(span?.output).toBe('{"tempC":21}')
    expect(span?.metadata['gen_ai.system']).toBe('vercel-ai')
    expect(span?.metadata['gen_ai.tool.name']).toBe('getWeather')
    expect(span?.metadata['gen_ai.tool.call.id']).toBe('tc_abc')
  })

  it('forwards arguments to the original execute with the same shape', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const execute = vi.fn().mockResolvedValue('ok')
    const wrapped = instrumentVercelAITools({ t: { execute } }, trace)
    await wrapped.t.execute!({ a: 1 }, { toolCallId: 'id-1', extra: true })
    expect(execute).toHaveBeenCalledWith({ a: 1 }, { toolCallId: 'id-1', extra: true })
    trace.finish()
  })

  it('omits gen_ai.tool.call.id when no toolCallId is provided', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools(
      { echo: { execute: vi.fn().mockResolvedValue('hi') } },
      trace,
    )
    await wrapped.echo.execute!('x')
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    expect(payload?.spans[0]?.metadata['gen_ai.tool.call.id']).toBeUndefined()
  })

  it('marks the span as errored and rethrows when the tool throws', async () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const wrapped = instrumentVercelAITools(
      { failing: { execute: vi.fn().mockRejectedValue(new Error('bad tool')) } },
      trace,
    )
    await expect(wrapped.failing.execute!({}, { toolCallId: 'tc_err' })).rejects.toThrow(
      'bad tool',
    )
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.error).toBe(true)
    expect(span?.error_message).toBe('bad tool')
    expect(span?.metadata['gen_ai.tool.name']).toBe('failing')
  })

  it('leaves tools without execute untouched', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const tools = { info: { description: 'no-op' } }
    const wrapped = instrumentVercelAITools(tools, trace)
    expect(wrapped.info).toBe(tools.info)
  })

  it('does not mutate the original tools record', () => {
    const batch = mockBatch()
    const trace = new TraceContext(batch, 'proj-1')
    const originalExecute = vi.fn().mockResolvedValue(1)
    const tools = { t: { execute: originalExecute } }
    instrumentVercelAITools(tools, trace)
    expect(tools.t.execute).toBe(originalExecute)
  })

  it('respects the trace redaction callback on input/output', async () => {
    const batch = mockBatch()
    const redact = (v: unknown): unknown => (typeof v === 'string' ? v.replace(/secret/g, '***') : v)
    const trace = new TraceContext(
      batch,
      'proj-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      redact,
    )
    const wrapped = instrumentVercelAITools(
      { t: { execute: vi.fn().mockResolvedValue('my secret out') } },
      trace,
    )
    await wrapped.t.execute!('my secret in')
    trace.finish()
    const payload = vi.mocked(batch.enqueue).mock.calls[0]?.[0]
    const span = payload?.spans[0]
    expect(span?.input).toBe('my *** in')
    expect(span?.output).toBe('my *** out')
  })
})
