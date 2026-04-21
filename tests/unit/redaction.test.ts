import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer } from '../../src/index.js'
import { TraceContext, SpanContext } from '../../src/trace.js'
import type { BatchSender } from '../../src/batch.js'

function mockBatch(): BatchSender {
  return { enqueue: vi.fn(), flush: vi.fn(), shutdown: vi.fn() } as unknown as BatchSender
}

function makeClient(redact?: (data: unknown) => unknown, sampleRate?: number): TruLayer {
  return new TruLayer({ apiKey: 'tl_test', projectName: 'proj-1', redact, sampleRate })
}

describe('PII redaction callback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no redact config: input/output stored as-is', async () => {
    const client = makeClient(undefined)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('hello')
      t.setOutput('world')
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.input).toBe('hello')
    expect(payload?.output).toBe('world')
  })

  it('redact replaces email field', async () => {
    const redact = (data: unknown): unknown => {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data) as Record<string, unknown>
        if ('user' in parsed) {
          return JSON.stringify({ ...parsed, user: '[REDACTED]' })
        }
      }
      return data
    }
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput(JSON.stringify({ user: 'alice@example.com' }))
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(JSON.parse(payload!.input!)).toEqual({ user: '[REDACTED]' })
  })

  it('redact returning null stores null', async () => {
    const redact = (): unknown => null
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('sensitive')
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.input).toBeNull()
  })

  it('redact throwing stores null and calls console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redact = (): unknown => {
      throw new Error('redaction failed')
    }
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('sensitive')
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.input).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('redact callback threw on input'),
    )
  })

  it('redaction applied on setInput, not deferred to flush', async () => {
    const calls: string[] = []
    const redact = (data: unknown): unknown => {
      calls.push('redact')
      return data
    }
    const batch = mockBatch()
    const ctx = new TraceContext(batch, 'proj-1', 'test', undefined, undefined, undefined, undefined, redact)
    ctx.setInput('data')
    // Redact was called immediately, before finish/flush
    expect(calls).toEqual(['redact'])
  })

  it('redaction applied on setOutput', async () => {
    const redact = (): unknown => '[SAFE]'
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setOutput('sensitive-output')
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.output).toBe('[SAFE]')
  })

  it('redact is not called for setMetadata (metadata is kept as-is)', async () => {
    const redact = vi.fn((data: unknown) => data)
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setMetadata({ secret: 'value' })
    })
    // redact should not have been called (only setMetadata, no setInput/setOutput)
    expect(redact).not.toHaveBeenCalled()
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.metadata).toEqual({ secret: 'value' })
  })

  it('nested span input is also redacted', async () => {
    const redact = (): unknown => '[REDACTED]'
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      await t.span('child', 'llm', async (span) => {
        span.setInput('child-input')
        span.setOutput('child-output')
      })
    })
    const payload = spy.mock.calls[0]?.[0]
    const childSpan = payload?.spans.find((s) => s.name === 'child')
    expect(childSpan?.input).toBe('[REDACTED]')
    expect(childSpan?.output).toBe('[REDACTED]')
  })

  it('sampleRate: 0 + redact defined: redact is never called (no-op trace)', async () => {
    const redact = vi.fn((data: unknown) => data)
    const client = makeClient(redact, 0)
    await client.trace('test', async (t) => {
      t.setInput('data')
      t.setOutput('data')
    })
    expect(redact).not.toHaveBeenCalled()
  })

  it('redact throwing on output stores null and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redact = (): unknown => {
      throw new Error('output redaction failed')
    }
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setOutput('sensitive')
    })
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.output).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('redact callback threw on output'),
    )
  })

  it('span-level redact throwing on output stores null and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const redact = (): unknown => {
      throw new Error('span output redaction failed')
    }
    const client = makeClient(redact)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      await t.span('child', 'llm', async (span) => {
        span.setOutput('sensitive')
      })
    })
    const payload = spy.mock.calls[0]?.[0]
    const childSpan = payload?.spans.find((s) => s.name === 'child')
    expect(childSpan?.output).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('redact callback threw on output'),
    )
  })
})
