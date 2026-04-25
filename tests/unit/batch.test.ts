import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchSender } from '../../src/batch.js'
import { InvalidAPIKeyError } from '../../src/errors.js'
import type { TraceData } from '../../src/model.js'

function makeTrace(id = 'trace-1'): TraceData {
  return {
    id,
    project_id: 'proj-1',
    session_id: null,
    name: null,
    input: null,
    output: null,
    error: null,
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

  describe('non-retryable 401 handling', () => {
    function make401(code: 'invalid_api_key' | 'api_key_expired') {
      return {
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: code }),
      }
    }

    it('halts immediately on 401 invalid_api_key without retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make401('invalid_api_key'))
      vi.stubGlobal('fetch', fetchMock)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const fatal = sender.getFatalError()
      expect(fatal).toBeInstanceOf(InvalidAPIKeyError)
      expect(fatal?.code).toBe('invalid_api_key')
      expect(fatal?.message).toContain('API key is invalid or has expired')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid or has expired'),
      )
    })

    it('halts immediately on 401 api_key_expired without retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make401('api_key_expired'))
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(sender.getFatalError()?.code).toBe('api_key_expired')
    })

    it('accepts the `code` field as well as `error`', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ code: 'invalid_api_key' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(sender.getFatalError()).toBeInstanceOf(InvalidAPIKeyError)
    })

    it('drops queued items and rejects new enqueues after latching', async () => {
      const fetchMock = vi.fn().mockResolvedValue(make401('invalid_api_key'))
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender({ batchSize: 1 })
      sender.enqueue(makeTrace('a')) // triggers send
      await new Promise((r) => setTimeout(r, 10))
      expect(sender.getFatalError()).not.toBeNull()

      fetchMock.mockClear()
      sender.enqueue(makeTrace('b'))
      sender.enqueue(makeTrace('c'))
      await sender.shutdown()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('treats other 401 payloads as retryable', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockResolvedValue({ error: 'unauthorized' }),
      })
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(sender.getFatalError()).toBeNull()
    })

    it('retries on 401 without a parseable body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn().mockRejectedValue(new Error('no body')),
      })
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const sender = makeSender()
      sender.enqueue(makeTrace())
      await sender.shutdown()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(sender.getFatalError()).toBeNull()
    })
  })
})

describe('InvalidAPIKeyError', () => {
  it('carries the expected name, message, and code', () => {
    const err = new InvalidAPIKeyError('invalid_api_key')
    expect(err.name).toBe('InvalidAPIKeyError')
    expect(err.code).toBe('invalid_api_key')
    expect(err.message).toBe(
      'API key is invalid or has expired — check your configuration.',
    )
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(InvalidAPIKeyError)
  })
})
