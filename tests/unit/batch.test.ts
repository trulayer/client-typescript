import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchSender } from '../../src/batch.js'
import type { TraceData } from '../../src/model.js'

function makeTrace(id = 'trace-1'): TraceData {
  return {
    id,
    project_id: 'proj-1',
    session_id: null,
    name: null,
    input: null,
    output: null,
    error: false,
    tags: [],
    metadata: {},
    spans: [],
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }
}

function makeSender(overrides?: Partial<{ batchSize: number; flushInterval: number }>): BatchSender {
  return new BatchSender(
    'tl_test',
    'https://api.trulayer.ai',
    overrides?.batchSize ?? 50,
    overrides?.flushInterval ?? 60_000,
  )
}

describe('BatchSender', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enqueue + shutdown sends traces', async () => {
    const sender = makeSender()
    sender.enqueue(makeTrace())
    await sender.shutdown()
    expect(fetch).toHaveBeenCalledOnce()
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.traces).toHaveLength(1)
  })

  it('shutdown with empty buffer is a no-op', async () => {
    const sender = makeSender()
    await sender.shutdown()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('flushes when batch size is reached', async () => {
    const sender = makeSender({ batchSize: 2 })
    sender.enqueue(makeTrace('a'))
    sender.enqueue(makeTrace('b')) // triggers flush
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).toHaveBeenCalled()
  })

  it('includes auth header', async () => {
    const sender = makeSender()
    sender.enqueue(makeTrace())
    await sender.shutdown()
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tl_test')
  })

  it('retries on server error and eventually warns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Override retry delay to speed up test
    const sender = new BatchSender('tl_test', 'https://api.trulayer.ai', 50, 60_000)
    sender.enqueue(makeTrace())
    await sender.shutdown()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[trulayer]'),
      expect.anything(),
    )
  })

  it('flush clears buffer and reschedules timer', async () => {
    const sender = makeSender()
    sender.enqueue(makeTrace())
    sender.flush()
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).toHaveBeenCalled()
    // After flush, buffer is empty — second shutdown sends nothing
    vi.mocked(fetch).mockClear()
    await sender.shutdown()
    expect(fetch).not.toHaveBeenCalled()
  })
})
