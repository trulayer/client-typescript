import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchSender, resolveFailMode } from '../../src/batch.js'
import { TruLayerFlushError } from '../../src/errors.js'
import type { TraceData } from '../../src/model.js'

function makeTrace(id = 'trace-1'): TraceData {
  return {
    id,
    project_id: 'proj-1',
    session_id: null,
    external_id: null,
    name: null,
    input: null,
    output: null,
    model: null,
    latency_ms: null,
    cost: null,
    error: false,
    error_message: null,
    tags: [],
    metadata: {},
    spans: [],
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  }
}

describe('resolveFailMode', () => {
  afterEach(() => {
    delete process.env['TRULAYER_FAIL_MODE']
  })

  it('defaults to "drop"', () => {
    expect(resolveFailMode()).toBe('drop')
  })

  it('reads TRULAYER_FAIL_MODE=block from env', () => {
    process.env['TRULAYER_FAIL_MODE'] = 'block'
    expect(resolveFailMode()).toBe('block')
  })

  it('ignores unrecognised values', () => {
    process.env['TRULAYER_FAIL_MODE'] = 'explode'
    expect(resolveFailMode()).toBe('drop')
  })

  it('explicit option overrides env', () => {
    process.env['TRULAYER_FAIL_MODE'] = 'block'
    expect(resolveFailMode('drop')).toBe('drop')
  })
})

describe('BatchSender — fail-mode behavior', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['TRULAYER_FAIL_MODE']
  })

  it('drop mode logs a single warning per failure window, not one per batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn')

    const sender = new BatchSender('tl_test', 'https://api.trulayer.ai', 50, 60_000)
    sender.enqueue(makeTrace('a'))
    await sender.shutdown()

    const senderCalls = warnSpy.mock.calls.filter((call) => {
      const first = call[0]
      return typeof first === 'string' && first.includes('failed to send batch')
    })
    expect(senderCalls).toHaveLength(1)

    // A second failing flush inside the warn window must not double-log.
    sender.enqueue(makeTrace('b'))
    await sender.shutdown()
    const senderCalls2 = warnSpy.mock.calls.filter((call) => {
      const first = call[0]
      return typeof first === 'string' && first.includes('failed to send batch')
    })
    expect(senderCalls2).toHaveLength(1)
  })

  it('block mode raises TruLayerFlushError on shutdown flush', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    process.env['TRULAYER_FAIL_MODE'] = 'block'
    const sender = new BatchSender('tl_test', 'https://api.trulayer.ai', 50, 60_000)
    sender.enqueue(makeTrace('a'))

    await expect(sender.shutdown()).rejects.toBeInstanceOf(TruLayerFlushError)
  })

  it('block mode TruLayerFlushError carries batch size and cause', async () => {
    const err = new Error('network down')
    const fetchMock = vi.fn().mockRejectedValue(err)
    vi.stubGlobal('fetch', fetchMock)

    const sender = new BatchSender(
      'tl_test',
      'https://api.trulayer.ai',
      50,
      60_000,
      { failMode: 'block' },
    )
    sender.enqueue(makeTrace('a'))
    sender.enqueue(makeTrace('b'))

    try {
      await sender.shutdown()
      throw new Error('expected shutdown to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(TruLayerFlushError)
      const flushErr = e as TruLayerFlushError
      expect(flushErr.batchSize).toBe(2)
      expect(flushErr.name).toBe('TruLayerFlushError')
      expect(flushErr.cause).toBe(err)
    }
  })

  it('drop mode (default) resolves shutdown even when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const sender = new BatchSender('tl_test', 'https://api.trulayer.ai', 50, 60_000)
    sender.enqueue(makeTrace('a'))
    await expect(sender.shutdown()).resolves.toBeUndefined()
  })

  it('explicit failMode option overrides TRULAYER_FAIL_MODE env', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    process.env['TRULAYER_FAIL_MODE'] = 'block'
    const sender = new BatchSender(
      'tl_test',
      'https://api.trulayer.ai',
      50,
      60_000,
      { failMode: 'drop' },
    )
    sender.enqueue(makeTrace('a'))
    await expect(sender.shutdown()).resolves.toBeUndefined()
    expect(sender.getFailMode()).toBe('drop')
  })
})

describe('TruLayerFlushError', () => {
  it('has the expected name, message, and batchSize', () => {
    const err = new TruLayerFlushError('boom', 7)
    expect(err.name).toBe('TruLayerFlushError')
    expect(err.batchSize).toBe(7)
    expect(err.message).toBe('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(TruLayerFlushError)
  })
})
