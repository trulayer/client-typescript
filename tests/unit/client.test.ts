import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TruLayer, init, getClient } from '../../src/index.js'

function makeClient(): TruLayer {
  return new TruLayer({ apiKey: 'tl_test', projectName: 'proj-1' })
}

describe('TruLayer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws if apiKey is missing', () => {
    expect(() => new TruLayer({ apiKey: '', projectName: 'proj-1' })).toThrow('apiKey')
  })

  it('throws if projectName is missing', () => {
    expect(() => new TruLayer({ apiKey: 'tl_test' })).toThrow('projectName')
  })

  it('accepts deprecated projectId alias and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tl = new TruLayer({ apiKey: 'tl_test', projectId: 'legacy' })
    expect(tl.projectName).toBe('legacy')
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toMatch(/projectId.*deprecated/)
  })

  it('trace runs callback and enqueues result', async () => {
    const client = makeClient()
    const spy = vi.spyOn(client._batch, 'enqueue')
    const result = await client.trace('my-trace', async (t) => {
      t.setInput('in').setOutput('out')
      return 42
    })
    expect(result).toBe(42)
    expect(spy).toHaveBeenCalledOnce()
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.name).toBe('my-trace')
    expect(payload?.input).toBe('in')
    expect(payload?.output).toBe('out')
  })

  it('trace marks error and re-throws on callback exception', async () => {
    const client = makeClient()
    const spy = vi.spyOn(client._batch, 'enqueue')
    await expect(
      client.trace('failing', async () => {
        throw new Error('kaboom')
      }),
    ).rejects.toThrow('kaboom')
    expect(spy.mock.calls[0]?.[0]?.error).toBe('kaboom')
  })

  it('trace passes sessionId, tags, metadata', async () => {
    const client = makeClient()
    const spy = vi.spyOn(client._batch, 'enqueue')
    await client.trace(
      'test',
      async () => {},
      { sessionId: 'sess-1', tags: ['a'], metadata: { env: 'ci' } },
    )
    const payload = spy.mock.calls[0]?.[0]
    expect(payload?.session_id).toBe('sess-1')
    expect(payload?.tags).toContain('a')
    expect(payload?.metadata).toMatchObject({ env: 'ci' })
  })

  it('feedback fires a POST request', async () => {
    const client = makeClient()
    client.feedback('trace-1', 'good', { score: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/feedback'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('feedback warns on network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient()
    client.feedback('trace-1', 'bad')
    await new Promise((r) => setTimeout(r, 10))
    expect(warnSpy).toHaveBeenCalled()
  })

  it('flush delegates to batch sender', () => {
    const client = makeClient()
    const spy = vi.spyOn(client._batch, 'flush')
    client.flush()
    expect(spy).toHaveBeenCalled()
  })

  it('shutdown delegates to batch sender', async () => {
    const client = makeClient()
    const spy = vi.spyOn(client._batch, 'shutdown').mockResolvedValue()
    await client.shutdown()
    expect(spy).toHaveBeenCalled()
  })
})

describe('init / getClient', () => {
  it('init returns a TruLayer instance', () => {
    const c = init({ apiKey: 'tl_x', projectName: 'p' })
    expect(c).toBeInstanceOf(TruLayer)
  })

  it('getClient returns the initialized instance', () => {
    const c = init({ apiKey: 'tl_x', projectName: 'p' })
    expect(getClient()).toBe(c)
  })
})
