import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer } from '../../src/index.js'
import { NoopTraceContext, NoopSpanContext } from '../../src/noop.js'

function makeClient(sampleRate?: number): TruLayer {
  return new TruLayer({ apiKey: 'tl_test', projectName: 'proj-1', sampleRate })
}

describe('Sampling rate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sampleRate: 1.0 — always creates a real trace', async () => {
    const client = makeClient(1.0)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('in')
    })
    expect(spy).toHaveBeenCalledOnce()
  })

  it('sampleRate: 0.0 — never creates a real trace', async () => {
    const client = makeClient(0.0)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('in')
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('sampleRate: 0.5 with Math.random returning 0.3 — trace is sent', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.3)
    const client = makeClient(0.5)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('in')
    })
    expect(spy).toHaveBeenCalledOnce()
    randomSpy.mockRestore()
  })

  it('sampleRate: 0.5 with Math.random returning 0.7 — trace is dropped', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7)
    const client = makeClient(0.5)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async (t) => {
      t.setInput('in')
    })
    expect(spy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('callback always executes regardless of sampling decision', async () => {
    let callbackRanSampled = false
    let callbackRanDropped = false

    // sampleRate 1.0 — sampled in
    const clientIn = makeClient(1.0)
    await clientIn.trace('test', async () => {
      callbackRanSampled = true
    })

    // sampleRate 0.0 — sampled out
    const clientOut = makeClient(0.0)
    await clientOut.trace('test', async () => {
      callbackRanDropped = true
    })

    expect(callbackRanSampled).toBe(true)
    expect(callbackRanDropped).toBe(true)
  })

  it('sampleRate unset behaves as 1.0', async () => {
    const client = makeClient(undefined)
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace('test', async () => {})
    expect(spy).toHaveBeenCalledOnce()
  })

  it('sampleRate: 1.0 does not call Math.random (fast path)', async () => {
    const randomSpy = vi.spyOn(Math, 'random')
    const client = makeClient(1.0)
    await client.trace('test', async () => {})
    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('sampleRate: 0.0 does not call Math.random (fast path)', async () => {
    const randomSpy = vi.spyOn(Math, 'random')
    const client = makeClient(0.0)
    await client.trace('test', async () => {})
    expect(randomSpy).not.toHaveBeenCalled()
    randomSpy.mockRestore()
  })

  it('sampled-out trace receives a NoopTraceContext', async () => {
    const client = makeClient(0.0)
    let receivedCtx: unknown
    await client.trace('test', async (t) => {
      receivedCtx = t
    })
    expect(receivedCtx).toBeInstanceOf(NoopTraceContext)
  })

  it('sampled-out trace returns callback result', async () => {
    const client = makeClient(0.0)
    const result = await client.trace('test', async () => 42)
    expect(result).toBe(42)
  })

  it('sampled-out trace re-throws callback errors', async () => {
    const client = makeClient(0.0)
    await expect(
      client.trace('test', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})

describe('NoopTraceContext', () => {
  it('setters are chainable no-ops', () => {
    const noop = new NoopTraceContext()
    const result = noop.setInput('x').setOutput('y').setModel('m').setCost(1).setMetadata({}).addTag('t')
    expect(result).toBe(noop)
  })

  it('span() executes callback and returns result', async () => {
    const noop = new NoopTraceContext()
    const result = await noop.span('test', 'llm', async () => 'ok')
    expect(result).toBe('ok')
  })

  it('span() provides a NoopSpanContext to the callback', async () => {
    const noop = new NoopTraceContext()
    let received: unknown
    await noop.span('test', 'llm', async (span) => {
      received = span
    })
    expect(received).toBeInstanceOf(NoopSpanContext)
  })
})

describe('NoopSpanContext', () => {
  it('setters are chainable no-ops', () => {
    const noop = new NoopSpanContext()
    const result = noop.setInput('x').setOutput('y').setModel('m').setTokens(1, 2).setMetadata({})
    expect(result).toBe(noop)
  })

  it('nested span() executes callback and returns result', async () => {
    const noop = new NoopSpanContext()
    const result = await noop.span('child', 'tool', async () => 99)
    expect(result).toBe(99)
  })
})
